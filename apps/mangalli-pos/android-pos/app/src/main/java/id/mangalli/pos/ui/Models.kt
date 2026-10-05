package id.mangalli.pos.ui

import id.mangalli.pos.network.ProductSnapshot
import id.mangalli.pos.network.TableSnapshot
import id.mangalli.pos.offline.CartItemEntity
import id.mangalli.pos.offline.CatalogProductEntity
import id.mangalli.pos.offline.LocalOrderEntity
import id.mangalli.pos.offline.LocalShiftEntity
import id.mangalli.pos.offline.OfflineOrders
import id.mangalli.pos.security.OfflineStaff
import org.json.JSONArray
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.ceil

// Keadaan layar tablet. MainActivity memegang data dan logika; UI hanya
// menggambar PosUiState dan memanggil PosActions.

enum class Screen { Menu, Orders, History, Shift, Settings }

data class ToastMessage(val id: Long, val text: String, val tone: Tone)

data class OutletInfo(
    val name: String,
    val logoUrl: String?,
    val outletKey: String,
    val taxRate: Double,
    val syncTimes: List<String>,
    val tables: List<TableSnapshot>,
    val menuUrl: String?,
    val customAmountMax: Double,
    // QRIS statis toko yang sah (kode publik merchant), dasar QRIS dinamis di layar dan cetakan.
    val qrisPayload: String? = null,
) {
    val qrisReady: Boolean get() = qrisPayload != null
}


data class OperationsState(
    val shift: LocalShiftEntity?,
    val summary: ShiftSummary?,
    val isOnline: Boolean,
    val unsynced: Int,
    val syncing: Boolean,
    val lastSync: Long?,
    val lastSyncMessage: String?,
    val nextSync: Long?,
    val clockOffsetMillis: Long? = null,
)

data class ShiftSummary(
    val orderCount: Int,
    val cashSales: Double,
    val nonCashSales: Double,
    val openBills: Int,
    val openBillTotal: Double,
    val expectedCash: Double,
    val cancelledCount: Int,
    val cashIn: Double = 0.0,
    val cashOut: Double = 0.0,
)

data class OrderDraft(
    val mode: String,
    val customerName: String,
    val tableNumber: String,
    val activeBillId: String?,
    val activeBillLabel: String?,
)

data class Pricing(val subtotal: Double, val discount: Double, val discountLabel: String?, val tax: Double, val total: Double)

// Promo yang berlaku sekarang beserta potongannya untuk isi pesanan saat ini (0 = belum memenuhi syarat).
data class PromoOption(val promo: id.mangalli.pos.offline.Promo, val discount: Double)

data class SaleResult(val code: String, val total: Double, val methodLabel: String, val change: Double?)

data class PaymentInput(val method: String, val tendered: Double, val reference: String)

data class PosUiState(
    val screen: Screen,
    val currentStaff: OfflineStaff?,
    val deviceRegistered: Boolean,
    val knownStaff: List<OfflineStaff>,
    val savedOutletKey: String,
    val serverHost: String,
    val debugBuild: Boolean,
    val appVersion: String,
    val busy: String?,
    val signInError: String?,
    val toast: ToastMessage?,
    val outlet: OutletInfo,
    val products: List<CatalogProductEntity>,
    val cart: List<CartItemEntity>,
    val draft: OrderDraft,
    val orders: List<LocalOrderEntity>,
    val history: List<LocalOrderEntity>,
    val shifts: List<LocalShiftEntity>,
    val operations: OperationsState,
    val paymentOpen: Boolean,
    val saleResult: SaleResult?,
    val pricing: Pricing = Pricing(0.0, 0.0, null, 0.0, 0.0),
    val promoOptions: List<PromoOption> = emptyList(),
    val tabletMode: TabletMode = TabletMode(keepScreenOn = true, locked = false),
    // Sisa stok per produk yang dilacak (dashboard − penjualan belum sinkron − keranjang).
    val stockLeft: Map<String, Int> = emptyMap(),
    // Versi baru yang tersedia di server; null = sudah terbaru atau belum dicek.
    val update: AppUpdateState? = null,
) {
    val isBusy: Boolean get() = busy != null
    val openBills: List<LocalOrderEntity> get() = orders.filter { it.source == "pos" && it.paymentStatus == "pending" && it.status != "cancelled" }
    val activeOrders: List<LocalOrderEntity> get() = orders.filter { it.status in ACTIVE_STATUSES }
    val needsAttention: Int get() = orders.count { it.status == "pending_payment" || it.status == "new" }
    val canManage: Boolean get() = currentStaff?.role in MANAGER_ROLES

    // Jumlah per baris yang sudah tersimpan di bill yang sedang dibuka; di bawah
    // angka ini item hanya bisa dikurangi lewat Void.
    val billQuantities: Map<String, Int> get() = draft.activeBillId
        ?.let { id -> orders.firstOrNull { it.localUuid == id } }
        ?.let { bill -> id.mangalli.pos.offline.OfflineOrders.itemsFromJson(bill.itemsJson).associate { it.cartLineId to it.quantity } }
        ?: emptyMap()
}

val MANAGER_ROLES = setOf("owner", "manager")

// Update aplikasi: wajib bila versi tablet di bawah versi minimum rilis.
// progress null = belum mengunduh; dismissed = kasir memilih "Later" (banner
// disembunyikan sampai aplikasi dibuka lagi; tetap ada di Settings).
data class AppUpdateState(
    val versionName: String,
    val notes: String,
    val required: Boolean,
    val open: Boolean = false,
    val dismissed: Boolean = false,
    val progress: Float? = null,
    val error: String? = null,
)

// Layar selalu menyala dan kunci ke Mangalli (screen pinning Android).
data class TabletMode(val keepScreenOn: Boolean, val locked: Boolean, val orderSound: Boolean = true)

// Aksi berpersetujuan (PIN) melapor hasilnya ke dialog pemanggil: null = berhasil
// (dialog ditutup), selain itu pesan galat yang ditampilkan di dialog, supaya
// isian tidak hilang dan pesan tidak tersembunyi di belakang dialog.
interface PosActions {
    fun navigate(screen: Screen)
    fun dismissToast()
    fun syncNow()

    fun signIn(outletKey: String, email: String, password: String)
    fun lock()
    fun forgetStaff(email: String)
    fun disconnectDevice()
    fun setServer(url: String)

    fun addProduct(product: CatalogProductEntity, options: List<ModifierOption>, quantity: Int, notes: String, replaceLineId: String?)
    fun changeQuantity(item: CartItemEntity, delta: Int)
    fun removeItem(item: CartItemEntity)
    fun clearOrder()
    fun applyPromo(promoId: Long?)
    fun applyCoupon(code: String)
    fun applyManualDiscount(kind: String, value: Double, reason: String, approvalPassword: String, onResult: ((String?) -> Unit)? = null)
    fun voidItem(item: CartItemEntity, quantity: Int, reason: String, approvalPassword: String, onResult: ((String?) -> Unit)? = null)
    fun addCustomAmount(label: String, amount: Double)
    fun setOrderMode(mode: String)
    fun setCustomerName(name: String)
    fun setTable(number: String)

    fun saveBill()
    fun openBill(localUuid: String)
    fun updateBillAndPrintNewItems()
    fun printBill()
    fun printQris(amount: Double, reference: String, context: String, onResult: ((String?) -> Unit)? = null)

    fun openPayment(open: Boolean)
    fun charge(input: PaymentInput)
    fun closeSaleResult()
    fun printLastReceipt()

    fun refreshOrders()
    fun updateOrderStatus(localUuid: String, status: String, approvalPassword: String, reason: String, onResult: ((String?) -> Unit)? = null)
    fun settleOrder(localUuid: String, input: PaymentInput)
    fun printOrderReceipt(localUuid: String)

    fun openShift(openingCash: Double)
    fun closeShift(countedCash: Double, note: String, approvalPassword: String, onResult: ((String?) -> Unit)? = null)
    fun recordCash(kind: String, amount: Double, reason: String, approvalPin: String, onResult: ((String?) -> Unit)? = null)
    fun printShiftReport(localUuid: String)
    fun reportProblem(category: String, message: String)

    fun checkForUpdate()
    fun openUpdate()
    fun dismissUpdate()
    fun startUpdate()

    fun setKeepScreenOn(on: Boolean)
    fun setOrderSound(on: Boolean)
    fun lockTablet()
    fun unlockTablet(approvalPin: String, onResult: ((String?) -> Unit)? = null)
}

val ACTIVE_STATUSES = setOf("pending_payment", "new", "accepted", "preparing", "ready")

const val PAYMENT_CASH = "cash"
const val PAYMENT_QRIS = "qris"
const val PAYMENT_EDC = "edc"
const val PAYMENT_TRANSFER = "transfer"
const val PAYMENT_OTHER = "other"
const val ORDER_MODE_TAKEAWAY = "takeaway"
const val ORDER_MODE_DINEIN = "dinein"

val paymentMethods = listOf(PAYMENT_CASH, PAYMENT_QRIS, PAYMENT_EDC, PAYMENT_TRANSFER, PAYMENT_OTHER)

fun paymentMethodLabel(method: String?): String = when (method) {
    PAYMENT_CASH -> "Cash"
    PAYMENT_QRIS -> "QRIS"
    PAYMENT_EDC -> "Card"
    PAYMENT_TRANSFER -> "Transfer"
    PAYMENT_OTHER -> "Other"
    null, "" -> "—"
    else -> method.replaceFirstChar { it.uppercase() }
}

fun paymentNotes(input: PaymentInput, total: Double): String = when (input.method) {
    PAYMENT_CASH -> "Cash received ${formatPrice(input.tendered)}; change ${formatPrice((input.tendered - total).coerceAtLeast(0.0))}"
    else -> listOf(paymentMethodLabel(input.method), input.reference.trim()).filter { it.isNotBlank() }.joinToString(" - ")
}

fun statusLabel(status: String): String = when (status) {
    "pending_payment" -> "Awaiting payment"
    "new" -> "New"
    "accepted", "preparing" -> "Preparing"
    "ready" -> "Ready"
    "completed" -> "Completed"
    "cancelled" -> "Cancelled"
    else -> status.replaceFirstChar { it.uppercase() }
}

fun statusTone(status: String): Tone = when (status) {
    "pending_payment", "new" -> Tone.Warning
    "accepted", "preparing" -> Tone.Info
    "ready" -> Tone.Success
    "cancelled" -> Tone.Danger
    else -> Tone.Neutral
}

// Kode tablet (#001) ditambah kode dashboard setelah sinkron, supaya kasir
// dan owner bisa mencocokkan transaksi yang sama.
fun LocalOrderEntity.code(): String =
    OfflineOrders.displayCode(this) + (serverOrderCode?.takeIf { source == "pos" }?.let { " · $it" } ?: "")

fun LocalOrderEntity.contextLabel(): String {
    val base = if (orderMode == ORDER_MODE_DINEIN) "Table ${tableNumber ?: "-"}" else "Takeaway"
    return listOfNotNull(base, customerName?.takeIf { it.isNotBlank() }).joinToString(" · ")
}

fun LocalOrderEntity.itemSummary(): String =
    OfflineOrders.itemsFromJson(itemsJson).joinToString(", ") { "${it.quantity}× ${it.name}" }

fun LocalOrderEntity.itemCount(): Int = OfflineOrders.itemsFromJson(itemsJson).sumOf { it.quantity }

fun itemCount(count: Int): String = if (count == 1) "1 item" else "$count items"

fun formatPrice(value: Double): String =
    "Rp ${"%,d".format(Locale.forLanguageTag("id-ID"), Math.round(value)).replace(',', '.')}"

fun clockLabel(millis: Long?): String =
    if (millis == null) "—" else SimpleDateFormat("HH:mm", Locale.ROOT).format(Date(millis))

fun dateTimeLabel(millis: Long?): String =
    if (millis == null) "—" else SimpleDateFormat("d MMM, HH:mm", Locale.ENGLISH).format(Date(millis))

fun elapsedLabel(millis: Long, now: Long = System.currentTimeMillis()): String {
    val minutes = ((now - millis) / 60_000).coerceAtLeast(0)
    return when {
        minutes < 1 -> "Just now"
        minutes < 60 -> "$minutes min"
        else -> "${minutes / 60} h ${minutes % 60} min"
    }
}

// Jam tablet dianggap salah bila berbeda lebih dari 5 menit dari server.
fun clockDriftLabel(offsetMillis: Long?): String? {
    if (offsetMillis == null || kotlin.math.abs(offsetMillis) < 5 * 60_000) return null
    val minutes = kotlin.math.abs(offsetMillis) / 60_000
    val span = if (minutes >= 60) "${minutes / 60} h ${minutes % 60} min" else "$minutes min"
    return "$span ${if (offsetMillis > 0) "behind" else "ahead of"} the server"
}

fun parseAmount(value: String): Double = value.filter { it.isDigit() }.toDoubleOrNull() ?: 0.0

// Pecahan uang yang biasa diterima kasir: pas, lalu pembulatan ke atas.
fun suggestedCashAmounts(total: Double): List<Double> {
    if (total <= 0) return emptyList()
    val steps = listOf(5_000.0, 10_000.0, 20_000.0, 50_000.0, 100_000.0)
    return (listOf(total) + steps.map { ceil(total / it) * it } + listOf(ceil(total / 100_000.0) * 100_000.0 + 100_000.0))
        .map { Math.round(it).toDouble() }
        .filter { it >= total }
        .distinct()
        .sorted()
        .take(5)
}

fun initials(name: String): String = name
    .split(Regex("\\s+"))
    .mapNotNull { word -> word.firstOrNull { it.isLetterOrDigit() } }
    .take(2)
    .joinToString("")
    .uppercase(Locale.ROOT)
    .ifBlank { "M" }

fun shiftSummaryOf(shift: LocalShiftEntity, orders: List<LocalOrderEntity>): ShiftSummary {
    val paid = orders.filter { it.paymentStatus == "completed" && it.status != "cancelled" }
    val cash = paid.filter { it.paymentMethod == PAYMENT_CASH }.sumOf { it.total }
    val open = orders.filter { it.source == "pos" && it.paymentStatus == "pending" && it.status != "cancelled" }
    val movements = id.mangalli.pos.offline.OfflineOrders.cashMovementsFromJson(shift.cashMovementsJson)
    val cashIn = movements.filter { it.kind == "in" }.sumOf { it.amount }
    val cashOut = movements.filter { it.kind == "out" }.sumOf { it.amount }
    return ShiftSummary(
        orderCount = paid.size,
        cashSales = cash,
        nonCashSales = paid.sumOf { it.total } - cash,
        openBills = open.size,
        openBillTotal = open.sumOf { it.total },
        expectedCash = shift.openingCash + cash + cashIn - cashOut,
        cancelledCount = orders.count { it.status == "cancelled" },
        cashIn = cashIn,
        cashOut = cashOut,
    )
}

// ---------- Pilihan produk (modifier) ----------

data class ModifierGroup(
    val id: Int,
    val name: String,
    val isRequired: Boolean,
    val minSelect: Int,
    val maxSelect: Int,
    val options: List<ModifierOption>,
) {
    fun effectiveMaxSelect(): Int = if (maxSelect > 0) maxSelect else options.size

    fun selectionHint(): String = when {
        isRequired && effectiveMaxSelect() == 1 -> "Required · choose 1"
        isRequired -> "Required · choose $minSelect–${effectiveMaxSelect()}"
        effectiveMaxSelect() == 1 -> "Optional · choose 1"
        else -> "Optional · up to ${effectiveMaxSelect()}"
    }
}

data class ModifierOption(val id: Int, val groupId: Int, val name: String, val priceDelta: Double)

fun modifierGroups(product: CatalogProductEntity): List<ModifierGroup> {
    val raw = product.modifierGroupsJson ?: return emptyList()
    return runCatching {
        val groups = JSONArray(raw)
        (0 until groups.length()).mapNotNull { groupIndex ->
            val group = groups.optJSONObject(groupIndex) ?: return@mapNotNull null
            val optionsJson = group.optJSONArray("options") ?: JSONArray()
            val options = (0 until optionsJson.length()).mapNotNull { optionIndex ->
                val option = optionsJson.optJSONObject(optionIndex) ?: return@mapNotNull null
                ModifierOption(
                    id = option.optInt("id"),
                    groupId = group.optInt("id"),
                    name = option.optString("name", "Option"),
                    priceDelta = option.optDouble("priceDelta", 0.0),
                )
            }.filter { it.id != 0 }
            if (options.isEmpty()) {
                null
            } else {
                val isRequired = group.optBoolean("isRequired", false)
                ModifierGroup(
                    id = group.optInt("id"),
                    name = group.optString("name", "Options"),
                    isRequired = isRequired,
                    minSelect = group.optInt("minSelect", if (isRequired) 1 else 0),
                    maxSelect = group.optInt("maxSelect", 1),
                    options = options,
                )
            }
        }
    }.getOrDefault(emptyList())
}

fun toggleModifierOption(current: Set<Int>, group: ModifierGroup, option: ModifierOption): Set<Int> {
    val optionIds = group.options.map { it.id }.toSet()
    val selectedInGroup = current.intersect(optionIds)
    if (group.effectiveMaxSelect() == 1) {
        // Pilihan tunggal opsional bisa dibatalkan dengan mengetuk lagi.
        return if (option.id in current && !group.isRequired) current - option.id else (current - optionIds) + option.id
    }
    return when {
        option.id in current -> current - option.id
        selectedInGroup.size < group.effectiveMaxSelect() -> current + option.id
        else -> current
    }
}

fun CartItemEntity.isCustomAmount(): Boolean = productId.startsWith("custom:")

fun CartItemEntity.modifierOptionIdSet(): Set<Int> = runCatching {
    val ids = JSONArray(modifierOptionIdsJson)
    (0 until ids.length()).mapNotNull { index -> ids.optInt(index).takeIf { it > 0 } }.toSet()
}.getOrDefault(emptySet())

fun displayNote(value: String?): String? =
    value?.trim().orEmpty().takeUnless { it.isBlank() || it.equals("null", ignoreCase = true) }

fun cartLineId(productId: String, optionIds: List<Int>, notes: String = ""): String {
    val optionKey = optionIds.sorted().joinToString("-")
    val notesKey = notes.trim().takeIf { it.isNotBlank() }?.let { Integer.toHexString(it.hashCode()) }
    return listOf(productId, optionKey, notesKey).filterNot { it.isNullOrBlank() }.joinToString(":")
}

fun mergeCartItems(items: List<CartItemEntity>): List<CartItemEntity> = items
    .groupBy { item ->
        if (item.isCustomAmount()) item.cartLineId
        else cartLineId(item.productId, item.modifierOptionIdSet().toList(), displayNote(item.notes).orEmpty())
    }
    .map { (lineId, rows) ->
        val first = rows.first()
        first.copy(cartLineId = lineId, quantity = rows.sumOf { it.quantity.coerceAtLeast(1) }, notes = displayNote(first.notes))
    }

fun List<ProductSnapshot>.toCatalogEntities(): List<CatalogProductEntity> {
    val syncedAt = System.currentTimeMillis()
    return map {
        CatalogProductEntity(
            id = it.id,
            name = it.name,
            price = it.price,
            categoryName = it.categoryName,
            photoUrl = it.photoUrl,
            syncedAtMillis = syncedAt,
            modifierGroupsJson = it.modifierGroupsJson,
            description = it.description,
            availability = it.availability,
            isBestSeller = it.isBestSeller,
            isFavorite = it.isFavorite,
            sortOrder = it.sortOrder,
            categorySortOrder = it.categorySortOrder,
            stock = it.stock,
        )
    }
}
