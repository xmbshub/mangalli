package id.mangalli.pos.offline

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction

@Dao
abstract class PosDao {
    // Urutan kategori dan produk mengikuti dashboard, seperti menu digital.
    @Query("SELECT * FROM catalog_products ORDER BY categorySortOrder, sortOrder, name")
    abstract fun products(): List<CatalogProductEntity>

    @Query("SELECT * FROM catalog_products ORDER BY name LIMIT 1")
    abstract fun firstProduct(): CatalogProductEntity?

    @Query("DELETE FROM catalog_products")
    abstract fun clearProducts()

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract fun insertProducts(products: List<CatalogProductEntity>)

    @Transaction
    open fun replaceProducts(products: List<CatalogProductEntity>) {
        clearProducts()
        insertProducts(products)
    }

    @Query("SELECT * FROM cart_items ORDER BY name")
    abstract fun cartItems(): List<CartItemEntity>

    @Query("SELECT * FROM cart_items WHERE cartLineId = :cartLineId LIMIT 1")
    abstract fun cartItem(cartLineId: String): CartItemEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract fun saveCartItem(item: CartItemEntity)

    @Query("DELETE FROM cart_items WHERE cartLineId = :cartLineId")
    abstract fun deleteCartItem(cartLineId: String)

    @Query("DELETE FROM cart_items")
    abstract fun clearCart()

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract fun saveBill(bill: SavedBillEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract fun saveBills(bills: List<SavedBillEntity>)

    @Query("SELECT * FROM saved_bills ORDER BY updatedAtMillis DESC")
    abstract fun savedBills(): List<SavedBillEntity>

    @Query("SELECT * FROM saved_bills WHERE billId = :billId LIMIT 1")
    abstract fun savedBill(billId: String): SavedBillEntity?

    @Query("DELETE FROM saved_bills WHERE billId = :billId")
    abstract fun deleteBill(billId: String)

    @Query("DELETE FROM saved_bills")
    abstract fun clearSavedBills()

    @Transaction
    open fun replaceSavedBills(bills: List<SavedBillEntity>) {
        clearSavedBills()
        saveBills(bills)
    }

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract fun enqueue(entity: SyncQueueEntity)

    @Query("SELECT * FROM sync_queue WHERE status = 'pending' ORDER BY createdAtMillis")
    abstract fun pendingSyncEvents(): List<SyncQueueEntity>

    @Query("SELECT COUNT(*) FROM sync_queue WHERE status = 'pending'")
    abstract fun pendingSyncCount(): Int

    @Query("UPDATE sync_queue SET status = 'synced', syncedAtMillis = :syncedAtMillis WHERE localUuid = :localUuid")
    abstract fun markSynced(localUuid: String, syncedAtMillis: Long)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract fun saveOrder(order: LocalOrderEntity)

    @Query("SELECT * FROM local_orders WHERE localUuid = :localUuid LIMIT 1")
    abstract fun order(localUuid: String): LocalOrderEntity?

    @Query("SELECT * FROM local_orders WHERE serverOrderId = :serverOrderId AND source = 'menu' LIMIT 1")
    abstract fun menuOrder(serverOrderId: Long): LocalOrderEntity?

    // Pesanan aktif, open bill, dan riwayat 3 hari terakhir untuk layar tablet.
    @Query("SELECT * FROM local_orders WHERE status NOT IN ('completed', 'cancelled') OR updatedAtMillis > :sinceMillis ORDER BY createdAtMillis")
    abstract fun recentOrders(sinceMillis: Long): List<LocalOrderEntity>

    @Query("SELECT * FROM local_orders WHERE dirty = 1 ORDER BY createdAtMillis LIMIT :limit")
    abstract fun dirtyOrders(limit: Int): List<LocalOrderEntity>

    // Penjualan kasir yang belum pernah sampai ke server: belum masuk hitungan stok server.
    @Query("SELECT * FROM local_orders WHERE source = 'pos' AND syncedAtMillis IS NULL AND status != 'cancelled'")
    abstract fun unsyncedPosOrders(): List<LocalOrderEntity>

    @Query("SELECT COUNT(*) FROM local_orders WHERE dirty = 1")
    abstract fun dirtyOrderCount(): Int

    @Query("UPDATE local_orders SET dirty = 0, syncedAtMillis = :syncedAtMillis, serverOrderId = coalesce(:serverOrderId, serverOrderId), serverOrderCode = coalesce(:serverOrderCode, serverOrderCode) WHERE localUuid = :localUuid AND updatedAtMillis = :updatedAtMillis")
    abstract fun markOrderSynced(localUuid: String, updatedAtMillis: Long, syncedAtMillis: Long, serverOrderId: Long?, serverOrderCode: String?)

    @Query("SELECT coalesce(max(displayNumber), 0) FROM local_orders WHERE businessDate = :businessDate AND source = 'pos'")
    abstract fun lastDisplayNumber(businessDate: String): Int

    @Query("SELECT * FROM local_orders WHERE source = 'pos' AND paymentStatus = 'pending' AND status != 'cancelled' ORDER BY createdAtMillis")
    abstract fun unpaidBills(): List<LocalOrderEntity>

    @Query("SELECT * FROM local_orders WHERE shiftLocalUuid = :shiftLocalUuid ORDER BY createdAtMillis")
    abstract fun shiftOrders(shiftLocalUuid: String): List<LocalOrderEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract fun saveShift(shift: LocalShiftEntity)

    @Query("SELECT * FROM local_shifts WHERE status = 'open' ORDER BY openedAtMillis DESC LIMIT 1")
    abstract fun openShift(): LocalShiftEntity?

    @Query("SELECT * FROM local_shifts ORDER BY openedAtMillis DESC LIMIT 1")
    abstract fun latestShift(): LocalShiftEntity?

    @Query("SELECT * FROM local_shifts ORDER BY openedAtMillis DESC LIMIT :limit")
    abstract fun recentShifts(limit: Int): List<LocalShiftEntity>

    // Riwayat transaksi tablet untuk layar History (termasuk yang sudah terkirim).
    @Query("SELECT * FROM local_orders WHERE createdAtMillis > :sinceMillis ORDER BY createdAtMillis DESC")
    abstract fun ordersSince(sinceMillis: Long): List<LocalOrderEntity>

    @Query("SELECT COUNT(*) FROM local_orders WHERE dirty = 1 OR status NOT IN ('completed', 'cancelled')")
    abstract fun unfinishedOrUnsyncedCount(): Int

    @Query("DELETE FROM local_orders")
    abstract fun clearOrders()

    @Query("DELETE FROM local_shifts")
    abstract fun clearShifts()

    @Query("SELECT * FROM local_shifts WHERE dirty = 1 ORDER BY openedAtMillis")
    abstract fun dirtyShifts(): List<LocalShiftEntity>

    @Query("UPDATE local_shifts SET dirty = 0, syncedAtMillis = :syncedAtMillis WHERE localUuid = :localUuid AND updatedAtMillis = :updatedAtMillis")
    abstract fun markShiftSynced(localUuid: String, updatedAtMillis: Long, syncedAtMillis: Long)
}
