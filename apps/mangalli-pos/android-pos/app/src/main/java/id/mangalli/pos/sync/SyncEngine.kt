package id.mangalli.pos.sync

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import id.mangalli.pos.network.AndroidPosApi
import id.mangalli.pos.network.BootstrapSnapshot
import id.mangalli.pos.network.MenuOrderSnapshot
import id.mangalli.pos.network.PosApiException
import id.mangalli.pos.offline.LocalOrderEntity
import id.mangalli.pos.offline.OfflineOrders
import id.mangalli.pos.offline.PosDao
import org.json.JSONArray

// Sinkron tablet ke dashboard Mangalli. Operasional kasir tidak pernah
// menunggu fungsi di sini: semua transaksi sudah tersimpan di tablet lebih dulu.
// Sinkron penuh berjalan pada jam terjadwal, saat kasir menekan Sinkron
// Sekarang, dan saat tutup shift. Pesanan menu digital dicek terpisah (ringan)
// tiap menit hanya bila tablet online.

data class SyncOutcome(
    val sentOrders: Int,
    val sentShifts: Int,
    val rejected: List<String>,
    val snapshot: BootstrapSnapshot?,
    val message: String,
)

class SyncEngine(
    private val context: Context,
    private val dao: PosDao,
    private val api: () -> AndroidPosApi,
    private val deviceToken: () -> String?,
    private val staffToken: () -> String?,
) {
    private val prefs = context.getSharedPreferences("mangalli_sync", Context.MODE_PRIVATE)

    val lastSyncMillis: Long get() = prefs.getLong(KEY_LAST_SYNC, 0L)
    val lastSyncMessage: String? get() = prefs.getString(KEY_LAST_MESSAGE, null)
    val lastMenuPollMillis: Long get() = prefs.getLong(KEY_LAST_MENU_POLL, 0L)

    fun isOnline(): Boolean = runCatching {
        val manager = context.getSystemService(ConnectivityManager::class.java) ?: return false
        val capabilities = manager.getNetworkCapabilities(manager.activeNetwork) ?: return false
        capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }.getOrDefault(false)

    @Synchronized
    fun syncNow(reason: String, legacyFlush: () -> Int): SyncOutcome {
        val device = deviceToken() ?: throw IllegalStateException("Sign in to the POS online once before syncing.")
        val staff = staffToken() ?: throw IllegalStateException("Sign in to the POS online once before syncing.")
        if (!isOnline()) throw IllegalStateException("No internet connection. Everything stays saved on this tablet.")

        legacyFlush()
        val rejected = mutableListOf<String>()
        var sentShifts = 0
        var sentOrders = 0

        val shifts = dao.dirtyShifts()
        if (shifts.isNotEmpty()) {
            val results = api().syncV2(device, staff, JSONArray().also { events -> shifts.forEach { events.put(OfflineOrders.shiftEvent(it)) } })
            val now = System.currentTimeMillis()
            shifts.forEach { shift ->
                val result = results.firstOrNull { it.type == "shift" && it.localUuid == shift.localUuid }
                if (result?.ok == true) {
                    dao.markShiftSynced(shift.localUuid, shift.updatedAtMillis, now)
                    sentShifts += 1
                } else {
                    rejected += "Shift ${shift.businessDate}: ${result?.message ?: "no response"}"
                }
            }
        }

        // Pesanan dikirim bertahap; batas per putaran menjaga sinkron tetap
        // selesai di koneksi lambat. Sisanya terkirim di sinkron berikutnya.
        dao.dirtyOrders(BATCH_SIZE * MAX_BATCHES).chunked(BATCH_SIZE).forEach { batch ->
            sentOrders += pushOrders(device, staff, batch, rejected)
        }

        // Menu yang gagal diperbarui dilaporkan, tidak disembunyikan: "Synced"
        // palsu membuat tablet menjual menu lama tanpa ada yang tahu.
        val bootstrap = runCatching { api().bootstrap(device, staff) }
        bootstrap.exceptionOrNull()?.let { error -> if (error is PosApiException && error.status in setOf(401, 403)) throw error }
        val snapshot = bootstrap.getOrNull()
        val message = buildString {
            append("Synced: ${plural(sentOrders, "order")} and ${plural(sentShifts, "shift")} sent")
            if (snapshot != null) append(", menu updated (${snapshot.products.size} items)")
            else append(". Menu not updated: ${bootstrap.exceptionOrNull()?.message ?: "unknown error"}")
            if (rejected.isNotEmpty()) append(". ${rejected.size} need attention: ${rejected.first()}")
            append('.')
        }
        prefs.edit()
            .putLong(KEY_LAST_SYNC, System.currentTimeMillis())
            .putString(KEY_LAST_MESSAGE, message)
            .apply()
        return SyncOutcome(sentOrders, sentShifts, rejected, snapshot, message)
    }

    // Perubahan pesanan menu digital dikirim segera bila online, supaya
    // pelanggan melihat status "diterima" tanpa menunggu jam sinkron.
    fun pushMenuUpdates(): Int {
        val device = deviceToken() ?: return 0
        val staff = staffToken() ?: return 0
        if (!isOnline()) return 0
        val batch = dao.dirtyOrders(BATCH_SIZE * 2).filter { it.source == "menu" }
        if (batch.isEmpty()) return 0
        return pushOrders(device, staff, batch, mutableListOf())
    }

    private fun pushOrders(device: String, staff: String, batch: List<LocalOrderEntity>, rejected: MutableList<String>): Int {
        val results = api().syncV2(device, staff, JSONArray().also { events -> batch.forEach { events.put(OfflineOrders.orderEvent(it)) } })
        val now = System.currentTimeMillis()
        var sent = 0
        batch.forEach { order ->
            val result = results.firstOrNull { result ->
                if (order.source == "menu") result.type == "menu_order" && result.localUuid.substringBeforeLast(':') == order.localUuid
                else result.type == "order" && result.localUuid == order.localUuid
            }
            if (result?.ok == true) {
                dao.markOrderSynced(order.localUuid, order.updatedAtMillis, now, result.serverId, result.orderCode)
                sent += 1
            } else {
                rejected += "${OfflineOrders.displayCode(order)}: ${result?.message ?: "no response"}"
            }
        }
        return sent
    }

    // Mengambil pesanan menu digital dan menyimpannya di tablet. Perubahan
    // lokal yang belum terkirim tidak ditimpa. Mengembalikan jumlah pesanan
    // menunggu bayar yang baru muncul dan pesanan yang lunas di luar tablet
    // (Midtrans atau kasir dashboard) sehingga kini masuk dapur.
    @Synchronized
    fun pollMenuOrders(): MenuPoll {
        val device = deviceToken() ?: return MenuPoll(0, 0)
        val staff = staffToken() ?: return MenuPoll(0, 0)
        if (!isOnline()) return MenuPoll(0, 0)
        val orders = api().menuOrders(device, staff)
        prefs.edit().putLong(KEY_LAST_MENU_POLL, System.currentTimeMillis()).apply()
        var newlyPending = 0
        var paidElsewhere = 0
        orders.forEach { remote ->
            val existing = dao.menuOrder(remote.id)
            if (existing?.dirty == true) return@forEach
            if (existing == null && remote.status == "pending_payment") newlyPending += 1
            if (existing?.status == "pending_payment" && remote.status !in setOf("pending_payment", "cancelled") && remote.paymentStatus == "completed") paidElsewhere += 1
            dao.saveOrder(remote.toEntity(existing))
        }
        return MenuPoll(newlyPending, paidElsewhere)
    }

    private fun MenuOrderSnapshot.toEntity(existing: LocalOrderEntity?): LocalOrderEntity {
        val created = OfflineOrders.millisFromIso(createdAt) ?: System.currentTimeMillis()
        val subtotal = totalAmount / (1 + OfflineOrders.taxRate)
        return LocalOrderEntity(
            localUuid = existing?.localUuid ?: "menu:$id",
            displayNumber = 0,
            source = "menu",
            serverOrderId = id,
            serverOrderCode = orderCode,
            shiftLocalUuid = existing?.shiftLocalUuid,
            businessDate = OfflineOrders.businessDate(created),
            orderMode = orderMode,
            tableNumber = tableNumber,
            customerName = customerName,
            notes = notes,
            status = status,
            paymentStatus = if (paymentStatus == "completed") "completed" else if (status == "cancelled") "cancelled" else "pending",
            paymentMethod = paymentMethod,
            paymentNotes = null,
            // Jumlah item yang sudah dicetak ke dapur disimpan di tablet.
            itemsJson = existing?.itemsJson ?: itemsJson,
            subtotal = subtotal,
            tax = totalAmount - subtotal,
            total = totalAmount,
            staffUserId = existing?.staffUserId,
            createdAtMillis = created,
            updatedAtMillis = existing?.updatedAtMillis ?: created,
            paidAtMillis = existing?.paidAtMillis,
            paymentDueAtMillis = OfflineOrders.millisFromIso(paymentDueAt),
            dirty = false,
            syncedAtMillis = System.currentTimeMillis(),
            eventsJson = existing?.eventsJson ?: "[]",
            cancelReason = existing?.cancelReason,
        )
    }

    companion object {
        private const val KEY_LAST_SYNC = "last_sync_millis"
        private const val KEY_LAST_MESSAGE = "last_sync_message"
        private const val KEY_LAST_MENU_POLL = "last_menu_poll_millis"
        private const val BATCH_SIZE = 25
        private const val MAX_BATCHES = 8
    }
}

private fun plural(count: Int, noun: String) = if (count == 1) "1 $noun" else "$count ${noun}s"

data class MenuPoll(val newPending: Int, val paidElsewhere: Int)
