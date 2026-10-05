package id.mangalli.pos.offline

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class StockRulesTest {
    private fun product(id: String, stock: Int?) = CatalogProductEntity(
        id = id, name = id, price = 20_000.0, categoryName = "Coffee", photoUrl = null, syncedAtMillis = 0, modifierGroupsJson = "[]", stock = stock,
    )

    private fun cart(productId: String, quantity: Int) = CartItemEntity(
        cartLineId = "$productId-line", productId = productId, name = productId, price = 20_000.0, quantity = quantity,
        modifierOptionIdsJson = "[]", modifierSummary = null, modifierTotal = 0.0, notes = null,
    )

    private fun order(id: String, productId: String, quantity: Int, status: String = "accepted") = LocalOrderEntity(
        localUuid = id, displayNumber = 1, source = "pos", serverOrderId = null, serverOrderCode = null, shiftLocalUuid = "shift",
        businessDate = "2026-09-26", orderMode = "takeaway", tableNumber = null, customerName = null, notes = null, status = status,
        cancelReason = null, paymentStatus = "pending", paymentMethod = null, paymentNotes = null,
        itemsJson = OfflineOrders.itemsToJson(OfflineOrders.itemsFromCart(listOf(cart(productId, quantity)))),
        subtotal = 0.0, tax = 0.0, total = 0.0, staffUserId = 1, createdAtMillis = 0, updatedAtMillis = 0, paidAtMillis = null,
        paymentDueAtMillis = null, dirty = true, syncedAtMillis = null,
    )

    @Test
    fun unsyncedSalesAndTheCartCountDownFromTheServerStock() {
        val left = StockRules.left(
            products = listOf(product("latte", 5), product("americano", null)),
            unsyncedOrders = listOf(order("sold", "latte", 2), order("cancelled", "latte", 3, status = "cancelled"), order("open-bill", "latte", 1)),
            cart = listOf(cart("latte", 1)),
            activeBillId = "open-bill",
        )
        // 5 - 2 terjual - 1 di keranjang (bill yang dibuka sudah ada di keranjang, bill batal tidak dihitung).
        assertEquals(2, left["latte"])
        assertFalse("untracked products have no limit", left.containsKey("americano"))
    }
}
