package id.mangalli.pos.offline

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "catalog_products")
data class CatalogProductEntity(
    @PrimaryKey val id: String,
    val name: String,
    val price: Double,
    val categoryName: String?,
    val photoUrl: String?,
    val syncedAtMillis: Long,
    val modifierGroupsJson: String?,
    // Sama dengan menu digital: deskripsi, status habis, penanda, dan urutan.
    val description: String? = null,
    val availability: String = "available",
    val isBestSeller: Boolean = false,
    val isFavorite: Boolean = false,
    val sortOrder: Int = 0,
    val categorySortOrder: Int = 0,
    // Sisa stok di server saat sinkron terakhir (null = tidak dilacak). Sisa di
    // tablet dihitung StockRules dari angka ini dan penjualan yang belum sinkron.
    val stock: Int? = null,
) {
    val isSoldOut: Boolean get() = availability != "available"
}

@Entity(tableName = "cart_items")
data class CartItemEntity(
    @PrimaryKey val cartLineId: String,
    val productId: String,
    val name: String,
    val price: Double,
    val quantity: Int,
    val modifierOptionIdsJson: String,
    val modifierSummary: String?,
    val modifierTotal: Double,
    val notes: String?,
)

@Entity(tableName = "saved_bills")
data class SavedBillEntity(
    @PrimaryKey val billId: String,
    val name: String,
    val orderMode: String,
    val customerName: String?,
    val tableNumber: Int?,
    val serverOrderId: Long?,
    val serverOrderCode: String?,
    val itemsJson: String,
    val itemCount: Int,
    val totalAmount: Double,
    val createdAtMillis: Long,
    val updatedAtMillis: Long,
)

@Entity(tableName = "sync_queue")
data class SyncQueueEntity(
    @PrimaryKey val localUuid: String,
    val idempotencyKey: String,
    val payloadJson: String,
    val status: String,
    val createdAtMillis: Long,
    val syncedAtMillis: Long?,
)

// Pesanan di tablet adalah sumber kebenaran operasional: dibuat, dibayar,
// diproses dapur, dan ditutup tanpa internet. `dirty` menandai snapshot yang
// belum terkirim ke dashboard. Pesanan menu digital (source = "menu") adalah
// cerminan pesanan server yang dibayar atau diproses di tablet.
@Entity(tableName = "local_orders")
data class LocalOrderEntity(
    @PrimaryKey val localUuid: String,
    val displayNumber: Int,
    val source: String,
    val serverOrderId: Long?,
    val serverOrderCode: String?,
    val shiftLocalUuid: String?,
    val businessDate: String,
    val orderMode: String,
    val tableNumber: Int?,
    val customerName: String?,
    val notes: String?,
    val status: String,
    val cancelReason: String?,
    val paymentStatus: String,
    val paymentMethod: String?,
    val paymentNotes: String?,
    val itemsJson: String,
    val subtotal: Double,
    val tax: Double,
    val total: Double,
    val staffUserId: Long?,
    val createdAtMillis: Long,
    val updatedAtMillis: Long,
    val paidAtMillis: Long?,
    val paymentDueAtMillis: Long?,
    val dirty: Boolean,
    val syncedAtMillis: Long?,
    // Void item dan pembatalan beserta penyetujunya (lihat OfflineOrders.OrderEvent).
    val eventsJson: String = "[]",
    // Diskon pesanan (nominal) dan pilihannya (promo atau manual, DiscountSpec).
    val discount: Double = 0.0,
    val discountJson: String? = null,
)

@Entity(tableName = "local_shifts")
data class LocalShiftEntity(
    @PrimaryKey val localUuid: String,
    val businessDate: String,
    val status: String,
    val openedAtMillis: Long,
    val closedAtMillis: Long?,
    val openingCash: Double,
    val actualCash: Double?,
    val openedByUserId: Long?,
    val openedByName: String?,
    val closedByUserId: Long?,
    val updatedAtMillis: Long,
    val dirty: Boolean,
    val syncedAtMillis: Long?,
    // Alasan selisih kas dan bill yang dibawa ke shift berikutnya.
    val notes: String? = null,
    // Yang menutup bisa berbeda dari yang membuka; kas kurang atau bill yang
    // dibawa oleh kasir disetujui manager/owner dengan PIN.
    val closedByName: String? = null,
    val approvedByUserId: Long? = null,
    val approvedByName: String? = null,
    val cashMovementsJson: String? = null,
)
