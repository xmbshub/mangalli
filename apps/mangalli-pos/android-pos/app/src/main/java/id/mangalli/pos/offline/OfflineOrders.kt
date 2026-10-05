package id.mangalli.pos.offline

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

// Aturan pesanan offline-first yang tidak bergantung pada UI, supaya bisa
// diuji dengan JUnit biasa.

data class LocalOrderItem(
    val cartLineId: String,
    val productId: String,
    val name: String,
    val unitPrice: Double,
    val quantity: Int,
    val modifierOptionIds: List<Int>,
    val modifierTotal: Double,
    val modifierSummary: String?,
    val notes: String?,
    val kitchenPrintedQuantity: Int,
) {
    val isCustomAmount: Boolean get() = productId.startsWith("custom:")
    val pendingKitchenQuantity: Int get() = if (isCustomAmount) 0 else (quantity - kitchenPrintedQuantity).coerceAtLeast(0)
}

// Kejadian sensitif pada pesanan: void item pada bill tersimpan atau
// pembatalan/refund. Dikirim ke server dan dicatat sekali di audit log.
data class OrderEvent(
    val id: String,
    val type: String,
    val summary: String,
    val reason: String?,
    val amount: Double,
    val byUserId: Long?,
    val approvedByUserId: Long?,
    val atMillis: Long,
)

// Uang keluar/masuk laci di luar penjualan (mis. beli galon, tambah uang kecil).
// Mengubah kas seharusnya shift; cash out oleh kasir disetujui PIN manager.
data class CashMovement(
    val id: String,
    val kind: String, // "in" atau "out"
    val amount: Double,
    val reason: String,
    val byUserId: Long?,
    val byName: String?,
    val approvedByUserId: Long?,
    val approvedByName: String?,
    val atMillis: Long,
) {
    val signed: Double get() = if (kind == "out") -amount else amount
}

object OfflineOrders {
    fun cashMovementsFromJson(raw: String?): List<CashMovement> = runCatching {
        val rows = JSONArray(raw ?: "[]")
        (0 until rows.length()).map { index ->
            val row = rows.getJSONObject(index)
            CashMovement(
                id = row.getString("id"), kind = row.getString("kind"), amount = row.getDouble("amount"), reason = row.optString("reason"),
                byUserId = row.optLong("byUserId").takeIf { it > 0 }, byName = row.optString("byName").ifBlank { null },
                approvedByUserId = row.optLong("approvedByUserId").takeIf { it > 0 }, approvedByName = row.optString("approvedByName").ifBlank { null },
                atMillis = row.getLong("atMillis"),
            )
        }
    }.getOrDefault(emptyList())

    fun cashMovementsToJson(movements: List<CashMovement>): String = JSONArray().also { rows ->
        movements.forEach {
            rows.put(JSONObject().put("id", it.id).put("kind", it.kind).put("amount", it.amount).put("reason", it.reason)
                .put("byUserId", it.byUserId ?: 0).put("byName", it.byName ?: "").put("approvedByUserId", it.approvedByUserId ?: 0)
                .put("approvedByName", it.approvedByName ?: "").put("atMillis", it.atMillis))
        }
    }.toString()

    // Tarif pajak outlet dari dashboard (0 untuk outlet tanpa pajak). Dibaca
    // dari penyimpanan tablet saat aplikasi mulai dan diperbarui tiap sinkron.
    @Volatile var taxRate: Double = 0.10

    fun taxLabel(): String = "Tax ${"%.1f".format(java.util.Locale.ROOT, taxRate * 100).removeSuffix(".0")}%"

    fun businessDate(millis: Long, zone: ZoneId = ZoneId.systemDefault()): String =
        Instant.ofEpochMilli(millis).atZone(zone).toLocalDate().toString()

    fun isoTime(millis: Long, zone: ZoneId = ZoneId.systemDefault()): String =
        Instant.ofEpochMilli(millis).atZone(zone).format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)

    fun tax(subtotal: Double): Double = Math.round(subtotal * taxRate).toDouble()

    fun itemsFromCart(cart: List<CartItemEntity>, previous: List<LocalOrderItem> = emptyList()): List<LocalOrderItem> {
        val printedByLine = previous.associate { it.cartLineId to it.kitchenPrintedQuantity }
        return cart.map { item ->
            LocalOrderItem(
                cartLineId = item.cartLineId,
                productId = item.productId,
                name = item.name,
                unitPrice = item.price,
                quantity = item.quantity,
                modifierOptionIds = parseIds(item.modifierOptionIdsJson),
                modifierTotal = item.modifierTotal,
                modifierSummary = item.modifierSummary,
                notes = item.notes,
                // Item yang sudah dicetak ke dapur tetap tercatat saat bill
                // dibuka dan diubah; hanya tambahan baru yang dicetak lagi.
                kitchenPrintedQuantity = (printedByLine[item.cartLineId] ?: 0).coerceAtMost(item.quantity),
            )
        }
    }

    fun itemsToJson(items: List<LocalOrderItem>): String = JSONArray().also { rows ->
        items.forEach { item ->
            rows.put(
                JSONObject()
                    .put("cartLineId", item.cartLineId)
                    .put("productId", item.productId)
                    .put("name", item.name)
                    .put("price", item.unitPrice)
                    .put("quantity", item.quantity)
                    .put("modifierOptionIds", JSONArray(item.modifierOptionIds))
                    .put("modifierTotal", item.modifierTotal)
                    .put("modifierSummary", item.modifierSummary ?: JSONObject.NULL)
                    .put("notes", item.notes ?: JSONObject.NULL)
                    .put("kitchenPrintedQuantity", item.kitchenPrintedQuantity),
            )
        }
    }.toString()

    fun itemsFromJson(raw: String): List<LocalOrderItem> = runCatching {
        val rows = JSONArray(raw)
        (0 until rows.length()).map { index ->
            val row = rows.getJSONObject(index)
            val ids = row.optJSONArray("modifierOptionIds")
            LocalOrderItem(
                cartLineId = row.optString("cartLineId").ifBlank { "line-$index" },
                productId = row.optString("productId"),
                name = row.optString("name"),
                unitPrice = row.optDouble("price", 0.0),
                quantity = row.optInt("quantity", 1).coerceAtLeast(1),
                modifierOptionIds = if (ids == null) emptyList() else (0 until ids.length()).map { ids.optInt(it) }.filter { it > 0 },
                modifierTotal = row.optDouble("modifierTotal", 0.0),
                modifierSummary = row.optString("modifierSummary").takeUnless { it.isBlank() || it == "null" },
                notes = row.optString("notes").takeUnless { it.isBlank() || it == "null" },
                kitchenPrintedQuantity = row.optInt("kitchenPrintedQuantity", 0).coerceAtLeast(0),
            )
        }
    }.getOrElse { emptyList() }

    fun markAllPrinted(items: List<LocalOrderItem>): List<LocalOrderItem> =
        items.map { if (it.isCustomAmount) it else it.copy(kitchenPrintedQuantity = it.quantity) }

    fun cartFromItems(items: List<LocalOrderItem>): List<CartItemEntity> = items.map { item ->
        CartItemEntity(
            cartLineId = item.cartLineId,
            productId = item.productId,
            name = item.name,
            price = item.unitPrice,
            quantity = item.quantity,
            modifierOptionIdsJson = JSONArray(item.modifierOptionIds).toString(),
            modifierSummary = item.modifierSummary,
            modifierTotal = item.modifierTotal,
            notes = item.notes,
        )
    }

    fun subtotal(items: List<LocalOrderItem>): Double = items.sumOf { it.unitPrice * it.quantity }

    // Pajak dihitung dari subtotal setelah diskon (sama dengan server).
    fun taxAfterDiscount(subtotal: Double, discount: Double): Double = tax((subtotal - discount).coerceAtLeast(0.0))

    fun totalAfterDiscount(subtotal: Double, discount: Double): Double {
        val taxable = (subtotal - discount).coerceAtLeast(0.0)
        return taxable + tax(taxable)
    }

    fun eventsFromJson(raw: String?): List<OrderEvent> = runCatching {
        val rows = JSONArray(raw ?: "[]")
        (0 until rows.length()).map { index ->
            val row = rows.getJSONObject(index)
            OrderEvent(
                id = row.getString("id"),
                type = row.getString("type"),
                summary = row.getString("summary"),
                reason = row.optString("reason").ifBlank { null },
                amount = row.optDouble("amount", 0.0),
                byUserId = row.optLong("byUserId").takeIf { it > 0 },
                approvedByUserId = row.optLong("approvedByUserId").takeIf { it > 0 },
                atMillis = row.optLong("at"),
            )
        }
    }.getOrElse { emptyList() }

    fun withEvent(raw: String?, event: OrderEvent): String = JSONArray().also { rows ->
        (eventsFromJson(raw) + event).forEach { item ->
            rows.put(
                JSONObject().put("id", item.id).put("type", item.type).put("summary", item.summary)
                    .put("reason", item.reason ?: JSONObject.NULL).put("amount", item.amount)
                    .put("byUserId", item.byUserId ?: JSONObject.NULL).put("approvedByUserId", item.approvedByUserId ?: JSONObject.NULL)
                    .put("at", item.atMillis),
            )
        }
    }.toString()

    private fun eventsForSync(raw: String?, zone: ZoneId): JSONArray = JSONArray().also { rows ->
        eventsFromJson(raw).forEach { event ->
            rows.put(
                JSONObject().put("id", event.id).put("type", event.type).put("summary", event.summary.take(300))
                    .put("reason", event.reason?.take(500) ?: JSONObject.NULL).put("amount", event.amount)
                    .put("byUserId", event.byUserId ?: JSONObject.NULL).put("approvedByUserId", event.approvedByUserId ?: JSONObject.NULL)
                    .put("at", isoTime(event.atMillis, zone)),
            )
        }
    }

    fun displayCode(order: LocalOrderEntity): String = when {
        order.source == "menu" -> order.serverOrderCode ?: "MENU"
        else -> "#%03d".format(order.displayNumber)
    }

    // Snapshot yang dikirim ke /api/android-pos/sync/v2.
    fun orderEvent(order: LocalOrderEntity, zone: ZoneId = ZoneId.systemDefault()): JSONObject {
        if (order.source == "menu") {
            return JSONObject()
                .put("type", "menu_order")
                .put(
                    "data",
                    JSONObject()
                        .put("localUuid", "${order.localUuid}:${order.updatedAtMillis}")
                        .put("serverOrderId", order.serverOrderId)
                        .put("shiftLocalUuid", order.shiftLocalUuid ?: JSONObject.NULL)
                        .put("status", order.status.takeIf { it != "pending_payment" } ?: JSONObject.NULL)
                        .put(
                            "payment",
                            if (order.paymentStatus == "completed" && order.paidAtMillis != null) {
                                JSONObject()
                                    .put("method", if (order.paymentMethod == "qris") "qris" else "cash")
                                    .put("paidAt", isoTime(order.paidAtMillis, zone))
                            } else {
                                JSONObject.NULL
                            },
                        )
                        .put("events", eventsForSync(order.eventsJson, zone)),
                )
        }
        val items = itemsFromJson(order.itemsJson)
        return JSONObject()
            .put("type", "order")
            .put(
                "data",
                JSONObject()
                    .put("localUuid", order.localUuid)
                    .put("shiftLocalUuid", order.shiftLocalUuid ?: JSONObject.NULL)
                    .put("businessDate", order.businessDate)
                    .put("createdAt", isoTime(order.createdAtMillis, zone))
                    .put("orderMode", order.orderMode)
                    .put("tableNumber", if (order.orderMode == "dinein") order.tableNumber ?: JSONObject.NULL else JSONObject.NULL)
                    .put("customerName", order.customerName ?: JSONObject.NULL)
                    .put("notes", order.notes ?: JSONObject.NULL)
                    .put("status", order.status)
                    .put("cancelReason", order.cancelReason ?: JSONObject.NULL)
                    .put("staffUserId", order.staffUserId ?: JSONObject.NULL)
                    .put("subtotal", order.subtotal)
                    .put("total", order.total)
                    .put("discount", if (order.discount > 0) DiscountSpec.fromJson(order.discountJson).let { spec ->
                        JSONObject().put("amount", order.discount).put("label", (spec?.label ?: "Discount").take(80)).put("promotionId", spec?.promoId ?: JSONObject.NULL)
                    } else JSONObject.NULL)
                    .put(
                        "payment",
                        JSONObject()
                            .put("status", order.paymentStatus)
                            .put("method", order.paymentMethod ?: JSONObject.NULL)
                            .put("notes", order.paymentNotes ?: JSONObject.NULL)
                            .put("paidAt", order.paidAtMillis?.let { isoTime(it, zone) } ?: JSONObject.NULL),
                    )
                    .put("items", JSONArray().also { rows ->
                        items.forEach { item ->
                            rows.put(
                                JSONObject()
                                    .put("productId", if (item.isCustomAmount) JSONObject.NULL else item.productId)
                                    .put("type", if (item.isCustomAmount) "custom_amount" else "product")
                                    .put("name", item.name.take(255))
                                    .put("quantity", item.quantity)
                                    .put("unitPrice", item.unitPrice)
                                    .put("modifierTotal", item.modifierTotal)
                                    .put("modifierOptionIds", JSONArray(item.modifierOptionIds))
                                    .put("modifierSummary", item.modifierSummary ?: JSONObject.NULL)
                                    .put("notes", item.notes ?: JSONObject.NULL)
                                    .put("sendToKitchen", !item.isCustomAmount)
                                    .put("kitchenPrintedQuantity", item.kitchenPrintedQuantity),
                            )
                        }
                    })
                    .put("events", eventsForSync(order.eventsJson, zone)),
            )
    }

    fun shiftEvent(shift: LocalShiftEntity, zone: ZoneId = ZoneId.systemDefault()): JSONObject = JSONObject()
        .put("type", "shift")
        .put(
            "data",
            JSONObject()
                .put("localUuid", shift.localUuid)
                .put("businessDate", shift.businessDate)
                .put("status", shift.status)
                .put("openedAt", isoTime(shift.openedAtMillis, zone))
                .put("closedAt", shift.closedAtMillis?.let { isoTime(it, zone) } ?: JSONObject.NULL)
                .put("openingCash", shift.openingCash)
                .put("actualCash", shift.actualCash ?: JSONObject.NULL)
                .put("openedByUserId", shift.openedByUserId ?: JSONObject.NULL)
                .put("closedByUserId", shift.closedByUserId ?: JSONObject.NULL)
                .put("approvedByUserId", shift.approvedByUserId ?: JSONObject.NULL)
                .put("cashMovements", JSONArray().also { rows ->
                    cashMovementsFromJson(shift.cashMovementsJson).forEach {
                        rows.put(JSONObject().put("localUuid", it.id).put("kind", it.kind).put("amount", it.amount).put("reason", it.reason.take(200))
                            .put("byUserId", it.byUserId ?: JSONObject.NULL).put("approvedByUserId", it.approvedByUserId ?: JSONObject.NULL)
                            .put("at", isoTime(it.atMillis, zone)))
                    }
                })
                .put("notes", shift.notes?.take(500) ?: JSONObject.NULL),
        )

    // Jadwal sinkron: jalan bila salah satu jam terjadwal sudah lewat sejak
    // sinkron terakhir (termasuk jam yang terlewat saat tablet mati).
    fun isSyncDue(syncTimes: List<String>, lastSyncMillis: Long, nowMillis: Long, zone: ZoneId = ZoneId.systemDefault()): Boolean {
        val latest = latestScheduledBefore(syncTimes, nowMillis, zone) ?: return false
        return lastSyncMillis < latest
    }

    fun latestScheduledBefore(syncTimes: List<String>, nowMillis: Long, zone: ZoneId = ZoneId.systemDefault()): Long? {
        val now = Instant.ofEpochMilli(nowMillis).atZone(zone)
        val times = syncTimes.mapNotNull { runCatching { LocalTime.parse(it) }.getOrNull() }
        if (times.isEmpty()) return null
        return listOf(now.toLocalDate(), now.toLocalDate().minusDays(1))
            .flatMap { date -> times.map { time -> ZonedDateTime.of(date, time, zone).toInstant().toEpochMilli() } }
            .filter { it <= nowMillis }
            .maxOrNull()
    }

    fun nextScheduled(syncTimes: List<String>, nowMillis: Long, zone: ZoneId = ZoneId.systemDefault()): Long? {
        val now = Instant.ofEpochMilli(nowMillis).atZone(zone)
        val times = syncTimes.mapNotNull { runCatching { LocalTime.parse(it) }.getOrNull() }
        if (times.isEmpty()) return null
        return listOf(now.toLocalDate(), now.toLocalDate().plusDays(1))
            .flatMap { date -> times.map { time -> ZonedDateTime.of(date, time, zone).toInstant().toEpochMilli() } }
            .filter { it > nowMillis }
            .minOrNull()
    }

    fun millisFromIso(value: String?): Long? = value?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }

    fun today(zone: ZoneId = ZoneId.systemDefault()): String = LocalDate.now(zone).toString()

    private fun parseIds(raw: String): List<Int> = runCatching {
        val ids = JSONArray(raw)
        (0 until ids.length()).map { ids.optInt(it) }.filter { it > 0 }
    }.getOrElse { emptyList() }
}
