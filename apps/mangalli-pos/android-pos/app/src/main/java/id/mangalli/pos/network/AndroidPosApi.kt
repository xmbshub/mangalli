package id.mangalli.pos.network

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

class AndroidPosApi(private val baseUrl: String) {
    companion object {
        // Selisih jam server dikurangi jam tablet dari respons terakhir.
        @Volatile var clockOffsetMillis: Long? = null
        // "0.8.0 (22)": dikirim di setiap permintaan, dashboard menampilkannya per tablet.
        @Volatile var appVersionHeader: String? = null
    }

    // Rilis terbaru; null bila belum ada rilis yang diterbitkan. Tanpa login.
    fun appUpdate(): id.mangalli.pos.update.AppRelease? {
        val release = request(path = "/api/android-pos/app-update", method = "GET").optJSONObject("release") ?: return null
        return id.mangalli.pos.update.AppRelease(
            versionCode = release.getInt("versionCode"),
            versionName = release.getString("versionName"),
            notes = release.optString("notes"),
            url = release.getString("url"),
            sha256 = release.getString("sha256").lowercase(),
            size = release.optLong("size"),
            minVersionCode = release.optInt("minVersionCode"),
        )
    }

    fun registerDevice(setupToken: String, outletKey: String, deviceKey: String): DeviceRegistration {
        val body = JSONObject()
            .put("outletKey", outletKey)
            .put("deviceKey", deviceKey)
            .put("label", "Android POS")

        val json = request(
            path = "/api/android-pos/device/register",
            method = "POST",
            bearerToken = setupToken,
            body = body,
        )

        return DeviceRegistration(
            deviceToken = json.getString("deviceToken"),
            outletKey = json.getJSONObject("device").getString("outletKey"),
        )
    }

    fun login(deviceToken: String, email: String, password: String): StaffLogin {
        val body = JSONObject()
            .put("email", email)
            .put("password", password)

        val json = request(
            path = "/api/android-pos/auth/login",
            method = "POST",
            bearerToken = deviceToken,
            body = body,
        )
        val staff = json.getJSONObject("staffSession").getJSONObject("staff")

        return StaffLogin(
            staffToken = json.getString("staffToken"),
            staffName = staff.getString("name"),
            posRole = staff.getString("posRole"),
            userId = staff.optLong("id"),
        )
    }

    fun deviceLogin(outletKey: String, email: String, password: String, deviceKey: String): DeviceLogin {
        val body = JSONObject()
            .put("outletKey", outletKey)
            .put("email", email)
            .put("password", password)
            .put("deviceKey", deviceKey)
            .put("label", "Android POS")

        val json = request(
            path = "/api/android-pos/auth/device-login",
            method = "POST",
            body = body,
        )
        val staff = json.getJSONObject("staffSession").getJSONObject("staff")

        return DeviceLogin(
            deviceToken = json.getString("deviceToken"),
            staffToken = json.getString("staffToken"),
            outletKey = json.getJSONObject("device").getString("outletKey"),
            staffName = staff.getString("name"),
            posRole = staff.getString("posRole"),
            userId = staff.optLong("id"),
        )
    }

    fun bootstrap(deviceToken: String, staffToken: String?): BootstrapSnapshot {
        val json = request(
            path = "/api/android-pos/bootstrap",
            method = "GET",
            bearerToken = deviceToken,
            staffToken = staffToken,
        )
        val products = json.getJSONArray("products")
        val firstProduct = if (products.length() > 0) products.getJSONObject(0) else null
        val activeShift = json.optJSONObject("activeShift")
        val categoryOrder = json.optJSONArray("categories")?.let { categories ->
            (0 until categories.length()).associate { categories.getJSONObject(it).optString("name") to it }
        }.orEmpty()
        val parsedProducts = (0 until products.length()).map { index ->
            val product = products.getJSONObject(index)
            val categoryName = product.optString("categoryName").ifBlank { null }
            ProductSnapshot(
                id = product.getString("id"),
                name = product.getString("name"),
                price = product.optDouble("price", 0.0),
                categoryName = categoryName,
                photoUrl = product.optString("photoUrl").takeUnless { it.isBlank() || it == "null" },
                modifierGroupsJson = product.optJSONArray("modifierGroups")?.toString() ?: "[]",
                description = product.optString("description").takeUnless { it.isBlank() || it == "null" },
                availability = product.optString("availability").ifBlank { "available" },
                isBestSeller = product.optBoolean("isBestSeller"),
                isFavorite = product.optBoolean("isPeopleLoveThis"),
                sortOrder = product.optInt("sortOrder"),
                categorySortOrder = categoryOrder[categoryName] ?: Int.MAX_VALUE / 2,
                stock = if (product.isNull("stock")) null else product.optInt("stock").coerceAtLeast(0),
            )
        }
        val tables = json.optJSONArray("tables")?.let { rows ->
            (0 until rows.length()).map { index ->
                val row = rows.getJSONObject(index)
                TableSnapshot(code = row.optString("tableCode"), label = row.optString("tableLabel"), area = row.optString("tableArea"))
            }
        }.orEmpty()

        val outlet = json.getJSONObject("outlet")

        return BootstrapSnapshot(
            outletName = outlet.optString("publicName").ifBlank { outlet.getString("name") },
            outletAddress = outlet.optString("address").ifBlank { null },
            outletPhone = outlet.optString("phone").ifBlank { null },
            outletLogoUrl = outlet.optString("logoImageUrl").ifBlank { null },
            activeShiftStatus = activeShift?.optString("status"),
            firstProductId = firstProduct?.getString("id"),
            firstProductName = firstProduct?.getString("name"),
            products = parsedProducts,
            catalogRevision = json.getString("catalogRevision"),
            customAmountMax = json.optJSONObject("limits")?.optDouble("customAmountMax", 10_000_000.0) ?: 10_000_000.0,
            syncTimes = json.optJSONArray("syncTimes")?.let { times -> (0 until times.length()).map { times.getString(it) } }
                ?: DEFAULT_SYNC_TIMES,
            menuUrl = outlet.optString("menuUrl").ifBlank { null },
            qrisPayload = outlet.optString("qrisPayload").ifBlank { null },
            taxRate = json.optDouble("taxRate", 0.10).coerceIn(0.0, 0.25),
            tables = tables,
            promotionsJson = json.optJSONArray("promotions")?.toString() ?: "[]",
            timezone = json.optString("timezone").ifBlank { "Asia/Jakarta" },
            approversJson = json.optJSONArray("approvers")?.toString() ?: "[]",
        )
    }

    // Sinkron offline-first: kirim snapshot shift, pesanan, dan perubahan
    // pesanan menu digital. Setiap event dijawab terpisah, jadi satu event
    // yang ditolak tidak menahan yang lain.
    fun report(deviceToken: String, staffToken: String?, body: JSONObject) {
        request(path = "/api/android-pos/reports", method = "POST", bearerToken = deviceToken, staffToken = staffToken, body = body)
    }

    fun syncV2(deviceToken: String, staffToken: String, events: JSONArray): List<SyncV2Result> {
        val json = request(
            path = "/api/android-pos/sync/v2",
            method = "POST",
            bearerToken = deviceToken,
            staffToken = staffToken,
            body = JSONObject().put("events", events),
            timeoutMillis = 30_000,
        )
        val results = json.getJSONArray("results")
        return (0 until results.length()).map { index ->
            val row = results.getJSONObject(index)
            SyncV2Result(
                type = row.optString("type"),
                localUuid = row.optString("localUuid"),
                ok = row.optBoolean("ok"),
                serverId = if (row.has("serverId")) row.optLong("serverId") else null,
                orderCode = row.optString("orderCode").ifBlank { null },
                message = row.optString("message").ifBlank { null },
            )
        }
    }

    // Pesanan menu digital untuk kasir: permintaan kecil, dipanggil tiap
    // menit hanya saat tablet online.
    fun menuOrders(deviceToken: String, staffToken: String): List<MenuOrderSnapshot> {
        val json = request(
            path = "/api/android-pos/menu-orders",
            method = "GET",
            bearerToken = deviceToken,
            staffToken = staffToken,
            timeoutMillis = 8_000,
        )
        val orders = json.getJSONArray("orders")
        return (0 until orders.length()).map { index ->
            val order = orders.getJSONObject(index)
            val items = order.getJSONArray("items")
            MenuOrderSnapshot(
                id = order.getLong("id"),
                orderCode = order.getString("orderCode"),
                status = order.getString("status"),
                orderMode = order.optString("orderMode", "takeaway"),
                tableNumber = if (order.isNull("tableNumber")) null else order.optInt("tableNumber"),
                customerName = order.optString("customerName").ifBlank { null },
                notes = order.optString("notes").ifBlank { null },
                createdAt = order.getString("createdAt"),
                paymentDueAt = order.optString("paymentDueAt").ifBlank { null },
                paymentStatus = order.optString("paymentStatus", "pending"),
                paymentMethod = order.optString("paymentMethod").ifBlank { null },
                totalAmount = order.optDouble("totalAmount", 0.0),
                itemsJson = JSONArray().also { rows ->
                    (0 until items.length()).forEach { itemIndex ->
                        val item = items.getJSONObject(itemIndex)
                        rows.put(
                            JSONObject()
                                .put("productId", item.optString("productId"))
                                .put("name", item.optString("name"))
                                .put("price", item.optDouble("unitPrice", 0.0))
                                .put("quantity", item.optInt("quantity", 1))
                                .put("modifierTotal", item.optDouble("modifierTotal", 0.0))
                                .put("modifierSummary", item.optString("modifierSummary").ifBlank { JSONObject.NULL })
                                .put("notes", item.optString("notes").ifBlank { JSONObject.NULL })
                                .put("kitchenPrintedQuantity", 0),
                        )
                    }
                }.toString(),
            )
        }
    }

    fun syncQueuedOrder(
        deviceToken: String,
        staffToken: String,
        localUuid: String,
        idempotencyKey: String,
        payloadJson: String,
    ): SyncResult {
        val event = JSONObject()
            .put("type", "cashier_order_created")
            .put("localUuid", localUuid)
            .put("idempotencyKey", idempotencyKey)
            .put("payload", JSONObject(payloadJson))
        val body = JSONObject().put("events", JSONArray().put(event))
        val json = request(
            path = "/api/android-pos/sync",
            method = "POST",
            bearerToken = deviceToken,
            staffToken = staffToken,
            body = body,
        )
        val rejected = json.getJSONArray("rejected")

        if (rejected.length() > 0) {
            return SyncResult(success = false, message = rejected.getJSONObject(0).getString("message"))
        }

        val accepted = json.getJSONArray("accepted").getJSONObject(0)

        return SyncResult(
            success = true,
            message = "Order ${accepted.optString("orderCode", accepted.getLong("orderId").toString())} synced",
            orderId = accepted.optLong("orderId").takeIf { it > 0 },
            orderCode = accepted.optString("orderCode").ifBlank { null },
        )
    }

    fun syncBill(
        deviceToken: String,
        staffToken: String,
        localUuid: String,
        idempotencyKey: String,
        payloadJson: String,
        updateExisting: Boolean,
    ): SyncResult {
        val event = JSONObject()
            .put("type", if (updateExisting) "cashier_bill_updated" else "cashier_bill_saved")
            .put("localUuid", localUuid)
            .put("idempotencyKey", idempotencyKey)
            .put("payload", JSONObject(payloadJson))
        val body = JSONObject().put("events", JSONArray().put(event))
        val json = request(
            path = "/api/android-pos/sync",
            method = "POST",
            bearerToken = deviceToken,
            staffToken = staffToken,
            body = body,
        )
        val rejected = json.getJSONArray("rejected")

        if (rejected.length() > 0) {
            return SyncResult(success = false, message = rejected.getJSONObject(0).getString("message"))
        }

        val accepted = json.getJSONArray("accepted").getJSONObject(0)
        val orderId = accepted.optLong("orderId").takeIf { it > 0 }
        val orderCode = accepted.optString("orderCode").ifBlank { orderId?.toString() }

        return SyncResult(
            success = true,
            message = "Bill ${orderCode ?: "new"} saved",
            orderId = orderId,
            orderCode = orderCode,
        )
    }

    fun orders(deviceToken: String, staffToken: String): List<OrderSnapshot> {
        val json = try {
            request(
                path = "/api/android-pos/orders",
                method = "GET",
                bearerToken = deviceToken,
                staffToken = staffToken,
            )
        } catch (exception: IllegalStateException) {
            if (exception.message?.startsWith("HTTP 404") == true) {
                throw IllegalStateException("The Android order endpoint is not available on the server. Deploy the backend first.")
            }

            throw exception
        }
        val orders = json.getJSONArray("orders")

        return (0 until orders.length()).map { index -> parseOrderSnapshot(orders.getJSONObject(index)) }
    }

    fun updateOrderStatus(
        deviceToken: String,
        staffToken: String,
        orderId: Long,
        status: String,
        approvalPin: String? = null,
        approvalReason: String? = null,
    ): OrderSnapshot {
        val body = JSONObject().put("status", status).apply {
            approvalPin?.takeIf { it.isNotBlank() }?.let { put("approval_pin", it) }
            approvalReason?.takeIf { it.isNotBlank() }?.let { put("approval_reason", it) }
        }
        val json = request(
            path = "/api/android-pos/orders/$orderId/status",
            method = "POST",
            bearerToken = deviceToken,
            staffToken = staffToken,
            body = body,
        )

        return parseOrderSnapshot(json.getJSONObject("order"))
    }

    fun settleOrder(
        deviceToken: String,
        staffToken: String,
        orderId: Long,
        paymentMethod: String,
        paymentNotes: String?,
        tenderedAmount: Double?,
    ): OrderSnapshot {
        val body = JSONObject()
            .put("paymentMethod", paymentMethod)
            .apply {
                paymentNotes?.takeIf { it.isNotBlank() }?.let { put("paymentNotes", it) }
                tenderedAmount?.let { put("tenderedAmount", it) }
            }
        val json = request(
            path = "/api/android-pos/orders/$orderId/settle",
            method = "POST",
            bearerToken = deviceToken,
            staffToken = staffToken,
            body = body,
        )

        return parseOrderSnapshot(json.getJSONObject("order"))
    }

    fun openBills(deviceToken: String, staffToken: String): List<OpenBillSnapshot> {
        val json = request(
            path = "/api/android-pos/bills",
            method = "GET",
            bearerToken = deviceToken,
            staffToken = staffToken,
        )
        val bills = json.getJSONArray("bills")

        return (0 until bills.length()).map { parseOpenBillSnapshot(bills.getJSONObject(it)) }
    }

    fun markKitchenTicketPrinted(
        deviceToken: String,
        staffToken: String,
        orderId: Long,
        items: List<OpenBillItemSnapshot>,
    ): OpenBillSnapshot {
        val body = JSONObject().put("items", JSONArray().also { rows ->
            items.forEach { item ->
                rows.put(
                    JSONObject()
                        .put("id", item.id)
                        .put("printedQuantity", item.kitchenPrintedQuantity + item.pendingKitchenQuantity)
                )
            }
        })
        val json = request(
            path = "/api/android-pos/orders/$orderId/ticket-printed",
            method = "POST",
            bearerToken = deviceToken,
            staffToken = staffToken,
            body = body,
        )

        return parseOpenBillSnapshot(json.getJSONObject("bill"))
    }

    private fun parseOpenBillSnapshot(bill: JSONObject): OpenBillSnapshot {
        val items = bill.getJSONArray("items")

        return OpenBillSnapshot(
            id = bill.getLong("id"),
            orderCode = bill.optString("orderCode").ifBlank { null },
            name = bill.optString("name", "Bill #${bill.getLong("id")}"),
            orderMode = bill.optString("orderMode", "takeaway"),
            customerName = bill.optString("customerName").ifBlank { null },
            tableNumber = bill.optInt("tableNumber").takeIf { it > 0 },
            itemCount = bill.optInt("itemCount"),
            totalAmount = bill.optDouble("totalAmount", 0.0),
            items = (0 until items.length()).map { itemIndex ->
                val item = items.getJSONObject(itemIndex)
                val quantity = item.optInt("quantity").coerceAtLeast(1)
                val printedQuantity = item.optInt("kitchenPrintedQuantity", 0).coerceAtLeast(0)
                OpenBillItemSnapshot(
                    id = item.getLong("id"),
                    productId = item.getString("productId"),
                    name = item.optString("name", "Products"),
                    quantity = quantity,
                    sendToKitchen = item.optBoolean("sendToKitchen", true),
                    kitchenPrintedQuantity = printedQuantity,
                    pendingKitchenQuantity = item.optInt(
                        "pendingKitchenQuantity",
                        (quantity - printedQuantity).coerceAtLeast(0),
                    ).coerceAtLeast(0),
                    unitPrice = item.optDouble("unitPrice", 0.0),
                    modifierOptionIds = item.optJSONArray("modifierOptionIds")?.let { optionIds ->
                        (0 until optionIds.length()).map { optionIds.optInt(it) }
                    } ?: emptyList(),
                    modifierSummary = item.optString("modifierSummary").ifBlank { null },
                    modifierTotal = item.optDouble("modifierTotal", 0.0),
                    notes = item.optString("notes").ifBlank { null },
                )
            },
        )
    }

    private fun parseOrderSnapshot(order: JSONObject): OrderSnapshot {
        val id = order.getLong("id")

        return OrderSnapshot(
            id = id,
            orderCode = order.optString("orderCode", "#$id"),
            customerName = order.optString("customerName", "Walk-in Customer"),
            restaurantStatus = order.optString("restaurantStatus", "new"),
            statusLabel = order.optString("statusLabel", "New Orders"),
            orderMode = order.optString("orderMode", "dinein"),
            tableLabel = order.optString("tableLabel").ifBlank { null },
            pickupName = order.optString("pickupName").ifBlank { null },
            totalAmount = order.optDouble("totalAmount", 0.0),
            paymentStatus = order.optString("paymentStatus").ifBlank { null },
            paymentMethod = order.optString("paymentMethod").ifBlank { null },
            itemSummary = order.optString("itemSummary").ifBlank { "No items." },
            createdAt = order.optString("createdAt").ifBlank { null },
        )
    }

    private fun request(
        path: String,
        method: String,
        bearerToken: String? = null,
        staffToken: String? = null,
        body: JSONObject? = null,
        timeoutMillis: Int = 15000,
    ): JSONObject {
        val url = URL(baseUrl.trimEnd('/') + path)
        val connection = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = timeoutMillis
            readTimeout = timeoutMillis
            setRequestProperty("Accept", "application/json")
            bearerToken?.let { setRequestProperty("Authorization", "Bearer $it") }
            staffToken?.let { setRequestProperty("X-Android-Staff-Token", it) }
            appVersionHeader?.let { setRequestProperty("X-Mangalli-App-Version", it) }
        }

        if (body != null) {
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
        }

        // Jam server dari header Date (tiap respons, termasuk galat) untuk
        // memperingatkan tablet yang jamnya salah.
        connection.date.takeIf { it > 0 }?.let { clockOffsetMillis = it - System.currentTimeMillis() }

        val stream = if (connection.responseCode in 200..299) {
            connection.inputStream
        } else {
            connection.errorStream
        }
        val response = stream.use { input ->
            BufferedReader(InputStreamReader(input)).readText()
        }

        if (connection.responseCode !in 200..299) {
            val serverMessage = runCatching {
                val json = JSONObject(response)
                json.optJSONObject("errors")?.let { errors -> errors.keys().asSequence().firstNotNullOfOrNull { errors.optJSONArray(it)?.optString(0) } }
                    ?: json.optString("message")
            }.getOrNull()?.takeIf { it.isNotBlank() && it != "The given data was invalid." }
            throw PosApiException(connection.responseCode, serverMessage)
        }

        return JSONObject(response)
    }
}

// Galat dari server dengan pesan yang bisa dibaca kasir, bukan JSON mentah.
class PosApiException(val status: Int, serverMessage: String?) : IllegalStateException(
    when {
        status == 401 || status == 403 -> "This tablet is no longer recognised by the outlet. An owner or manager should disconnect it in Settings and sign in again."
        status == 429 -> "Too many attempts. Wait a minute and try again."
        status >= 500 -> "The Mangalli server is having trouble. Everything stays saved on this tablet."
        !serverMessage.isNullOrBlank() -> serverMessage
        else -> "Request failed ($status)."
    },
)

data class DeviceRegistration(val deviceToken: String, val outletKey: String)

val DEFAULT_SYNC_TIMES = listOf("11:00", "15:00", "19:00", "23:00")

data class StaffLogin(val staffToken: String, val staffName: String, val posRole: String, val userId: Long)

data class DeviceLogin(
    val deviceToken: String,
    val staffToken: String,
    val outletKey: String,
    val staffName: String,
    val posRole: String,
    val userId: Long,
)

data class BootstrapSnapshot(
    val outletName: String,
    val outletAddress: String?,
    val outletPhone: String?,
    val outletLogoUrl: String?,
    val activeShiftStatus: String?,
    val firstProductId: String?,
    val firstProductName: String?,
    val products: List<ProductSnapshot>,
    val catalogRevision: String,
    val customAmountMax: Double,
    val syncTimes: List<String> = DEFAULT_SYNC_TIMES,
    val menuUrl: String? = null,
    val qrisPayload: String? = null,
    val taxRate: Double = 0.10,
    val tables: List<TableSnapshot> = emptyList(),
    val promotionsJson: String = "[]",
    val timezone: String = "Asia/Jakarta",
    // Hash PIN persetujuan manager/owner (bukan PIN-nya), disimpan terenkripsi.
    val approversJson: String = "[]",
)

// Meja aktif outlet untuk pilihan Dine In di kasir. Nomor diambil dari kode
// atau nama meja (T07 atau "Table 7" menjadi 7), sama seperti menu digital.
data class TableSnapshot(val code: String, val label: String, val area: String) {
    val number: Int? get() = Regex("\\d+").find(code)?.value?.toIntOrNull() ?: Regex("\\d+").find(label)?.value?.toIntOrNull()
}

data class SyncV2Result(
    val type: String,
    val localUuid: String,
    val ok: Boolean,
    val serverId: Long?,
    val orderCode: String?,
    val message: String?,
)

data class MenuOrderSnapshot(
    val id: Long,
    val orderCode: String,
    val status: String,
    val orderMode: String,
    val tableNumber: Int?,
    val customerName: String?,
    val notes: String?,
    val createdAt: String,
    val paymentDueAt: String?,
    val paymentStatus: String,
    val paymentMethod: String?,
    val totalAmount: Double,
    val itemsJson: String,
)

data class ProductSnapshot(
    val id: String,
    val name: String,
    val price: Double,
    val categoryName: String?,
    val photoUrl: String?,
    val modifierGroupsJson: String,
    val description: String? = null,
    val availability: String = "available",
    val isBestSeller: Boolean = false,
    val isFavorite: Boolean = false,
    val sortOrder: Int = 0,
    val categorySortOrder: Int = 0,
    val stock: Int? = null,
)

data class SyncResult(
    val success: Boolean,
    val message: String,
    val orderId: Long? = null,
    val orderCode: String? = null,
)

data class OpenBillSnapshot(
    val id: Long,
    val orderCode: String?,
    val name: String,
    val orderMode: String,
    val customerName: String?,
    val tableNumber: Int?,
    val itemCount: Int,
    val totalAmount: Double,
    val items: List<OpenBillItemSnapshot>,
)

data class OpenBillItemSnapshot(
    val id: Long,
    val productId: String,
    val name: String,
    val quantity: Int,
    val sendToKitchen: Boolean,
    val kitchenPrintedQuantity: Int,
    val pendingKitchenQuantity: Int,
    val unitPrice: Double,
    val modifierOptionIds: List<Int>,
    val modifierSummary: String?,
    val modifierTotal: Double,
    val notes: String?,
)

data class OrderSnapshot(
    val id: Long,
    val orderCode: String,
    val customerName: String,
    val restaurantStatus: String,
    val statusLabel: String,
    val orderMode: String,
    val tableLabel: String?,
    val pickupName: String?,
    val totalAmount: Double,
    val paymentStatus: String?,
    val paymentMethod: String?,
    val itemSummary: String,
    val createdAt: String?,
    // Pesanan lokal di tablet (offline-first). Kosong untuk data server lama.
    val localUuid: String? = null,
    val source: String = "pos",
    val synced: Boolean = true,
)
