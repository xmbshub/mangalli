package id.mangalli.pos.offline

// Sisa stok di tablet. Server menghitung stok dari semua pesanan yang sudah ia
// terima (termasuk menu digital); tablet menguranginya lagi dengan penjualan
// kasir yang belum pernah sinkron dan isi keranjang. Bill yang sedang dibuka
// sudah ada di keranjang, jadi tidak dihitung dua kali.
object StockRules {
    /** Sisa per produk yang stoknya dilacak; produk tanpa stok tidak ada di peta. */
    fun left(
        products: List<CatalogProductEntity>,
        unsyncedOrders: List<LocalOrderEntity>,
        cart: List<CartItemEntity>,
        activeBillId: String?,
    ): Map<String, Int> {
        val tracked = products.mapNotNull { product -> product.stock?.let { product.id to it } }.toMap()
        if (tracked.isEmpty()) return emptyMap()
        val used = HashMap<String, Int>()
        unsyncedOrders.filter { it.localUuid != activeBillId && it.status != "cancelled" }.forEach { order ->
            OfflineOrders.itemsFromJson(order.itemsJson).forEach { item -> used.merge(item.productId, item.quantity, Int::plus) }
        }
        cart.forEach { item -> used.merge(item.productId, item.quantity, Int::plus) }
        return tracked.mapValues { (id, stock) -> stock - (used[id] ?: 0) }
    }
}
