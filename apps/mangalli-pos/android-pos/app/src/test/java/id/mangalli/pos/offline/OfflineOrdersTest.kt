package id.mangalli.pos.offline

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

class OfflineOrdersTest {
    private val zone = ZoneId.of("Asia/Makassar")

    private fun at(hour: Int, minute: Int, day: Int = 25) =
        ZonedDateTime.of(2026, 9, day, hour, minute, 0, 0, zone).toInstant().toEpochMilli()

    private fun cartLine(id: String, quantity: Int, product: String = "latte") = CartItemEntity(
        cartLineId = id, productId = product, name = "Latte", price = 38000.0, quantity = quantity,
        modifierOptionIdsJson = "[2]", modifierSummary = "Large", modifierTotal = 10000.0, notes = null,
    )

    @Test
    fun reopenedBillPrintsOnlyNewKitchenQuantities() {
        val first = OfflineOrders.markAllPrinted(OfflineOrders.itemsFromCart(listOf(cartLine("a", 2))))
        val edited = OfflineOrders.itemsFromCart(listOf(cartLine("a", 3), cartLine("b", 1, "americano")), first)
        assertEquals(1, edited.first { it.cartLineId == "a" }.pendingKitchenQuantity)
        assertEquals(1, edited.first { it.cartLineId == "b" }.pendingKitchenQuantity)
        val roundTrip = OfflineOrders.itemsFromJson(OfflineOrders.itemsToJson(edited))
        assertEquals(edited, roundTrip)
    }

    @Test
    fun customAmountNeverGoesToTheKitchen() {
        val items = OfflineOrders.itemsFromCart(listOf(cartLine("custom:1", 1, "custom:1")))
        assertEquals(0, items.single().pendingKitchenQuantity)
        val event = OfflineOrders.orderEvent(order(items), zone).getJSONObject("data")
        val item = event.getJSONArray("items").getJSONObject(0)
        assertEquals("custom_amount", item.getString("type"))
        assertTrue(item.isNull("productId"))
        assertFalse(item.getBoolean("sendToKitchen"))
    }

    @Test
    fun orderEventCarriesTabletTimeAndPayment() {
        val data = OfflineOrders.orderEvent(order(OfflineOrders.itemsFromCart(listOf(cartLine("a", 1))), paid = true), zone).getJSONObject("data")
        assertEquals("2026-09-25T09:15:00+08:00", data.getString("createdAt"))
        assertEquals("completed", data.getJSONObject("payment").getString("status"))
        assertEquals("cash", data.getJSONObject("payment").getString("method"))
        assertEquals(5, data.getInt("tableNumber"))
    }

    @Test
    fun menuOrderEventUsesServerIdAndUniqueEventKey() {
        val menu = order(OfflineOrders.itemsFromCart(listOf(cartLine("a", 1))), paid = true)
            .copy(localUuid = "menu:42", source = "menu", serverOrderId = 42, status = "new", paymentMethod = "qris")
        val event = OfflineOrders.orderEvent(menu, zone)
        assertEquals("menu_order", event.getString("type"))
        val data = event.getJSONObject("data")
        assertEquals(42L, data.getLong("serverOrderId"))
        assertEquals("menu:42", data.getString("localUuid").substringBeforeLast(':'))
        assertEquals("qris", data.getJSONObject("payment").getString("method"))
    }

    @Test
    fun scheduledSyncRunsOnceAfterEachTimeIncludingMissedOnes() {
        val times = listOf("11:00", "15:00", "19:00", "23:00")
        assertFalse(OfflineOrders.isSyncDue(times, lastSyncMillis = at(11, 5), nowMillis = at(14, 59), zone = zone))
        assertTrue(OfflineOrders.isSyncDue(times, lastSyncMillis = at(11, 5), nowMillis = at(15, 1), zone = zone))
        // Tablet mati semalam: jam 23:00 kemarin yang terlewat tetap dikejar pagi ini.
        assertTrue(OfflineOrders.isSyncDue(times, lastSyncMillis = at(19, 30, day = 24), nowMillis = at(8, 0), zone = zone))
        assertEquals(at(11, 0), OfflineOrders.nextScheduled(times, at(8, 0), zone))
        assertEquals(at(11, 0, day = 26), OfflineOrders.nextScheduled(times, at(23, 30), zone))
    }

    private fun order(items: List<LocalOrderItem>, paid: Boolean = false) = LocalOrderEntity(
        localUuid = "0f7d3c1e-1111-2222-3333-444455556666", displayNumber = 7, source = "pos", serverOrderId = null,
        serverOrderCode = null, shiftLocalUuid = "shift-1", businessDate = "2026-09-25", orderMode = "dinein", tableNumber = 5,
        customerName = null, notes = null, status = "accepted", cancelReason = null,
        paymentStatus = if (paid) "completed" else "pending", paymentMethod = if (paid) "cash" else null, paymentNotes = null,
        itemsJson = OfflineOrders.itemsToJson(items), subtotal = OfflineOrders.subtotal(items), tax = 0.0,
        total = OfflineOrders.subtotal(items), staffUserId = 1, createdAtMillis = at(9, 15), updatedAtMillis = at(9, 20),
        paidAtMillis = if (paid) at(9, 20) else null, paymentDueAtMillis = null, dirty = true, syncedAtMillis = null,
    )

    @Test
    fun taxFollowsTheOutletRate() {
        val previous = OfflineOrders.taxRate
        try {
            OfflineOrders.taxRate = 0.0
            assertEquals(0.0, OfflineOrders.tax(50_000.0), 0.001)
            assertEquals("Tax 0%", OfflineOrders.taxLabel())
            OfflineOrders.taxRate = 0.105
            assertEquals(5_250.0, OfflineOrders.tax(50_000.0), 0.001)
            assertEquals("Tax 10.5%", OfflineOrders.taxLabel())
        } finally {
            OfflineOrders.taxRate = previous
        }
    }
}
