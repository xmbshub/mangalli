package id.mangalli.pos.offline

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [
        CatalogProductEntity::class,
        CartItemEntity::class,
        SavedBillEntity::class,
        SyncQueueEntity::class,
        LocalOrderEntity::class,
        LocalShiftEntity::class,
    ],
    version = 13,
    exportSchema = false,
)
abstract class PosDatabase : RoomDatabase() {
    abstract fun posDao(): PosDao

    companion object {
        @Volatile private var instance: PosDatabase? = null

        fun get(context: Context): PosDatabase {
            return instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    PosDatabase::class.java,
                    "mangalli_pos.db",
                )
                    .addMigrations(MIGRATION_1_2, MIGRATION_2_3)
                    .addMigrations(MIGRATION_3_4, MIGRATION_4_5, MIGRATION_5_6, MIGRATION_6_7, MIGRATION_7_8, MIGRATION_8_9, MIGRATION_9_10, MIGRATION_10_11, MIGRATION_11_12, MIGRATION_12_13)
                    .build()
                    .also { instance = it }
            }
        }

        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE catalog_products ADD COLUMN modifierGroupsJson TEXT")
                db.execSQL(
                    """
                    CREATE TABLE cart_items_new (
                        cartLineId TEXT NOT NULL PRIMARY KEY,
                        productId TEXT NOT NULL,
                        name TEXT NOT NULL,
                        price REAL NOT NULL,
                        quantity INTEGER NOT NULL,
                        modifierOptionIdsJson TEXT NOT NULL DEFAULT '[]',
                        modifierSummary TEXT,
                        modifierTotal REAL NOT NULL DEFAULT 0
                    )
                    """.trimIndent()
                )
                db.execSQL(
                    """
                    INSERT INTO cart_items_new (
                        cartLineId,
                        productId,
                        name,
                        price,
                        quantity,
                        modifierOptionIdsJson,
                        modifierSummary,
                        modifierTotal
                    )
                    SELECT productId, productId, name, price, quantity, '[]', NULL, 0 FROM cart_items
                    """.trimIndent()
                )
                db.execSQL("DROP TABLE cart_items")
                db.execSQL("ALTER TABLE cart_items_new RENAME TO cart_items")
            }
        }

        private val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE cart_items ADD COLUMN notes TEXT")
            }
        }

        private val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE saved_bills (
                        billId TEXT NOT NULL PRIMARY KEY,
                        name TEXT NOT NULL,
                        itemsJson TEXT NOT NULL,
                        itemCount INTEGER NOT NULL,
                        totalAmount REAL NOT NULL,
                        createdAtMillis INTEGER NOT NULL,
                        updatedAtMillis INTEGER NOT NULL
                    )
                    """.trimIndent()
                )
            }
        }

        private val MIGRATION_4_5 = object : Migration(4, 5) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE saved_bills ADD COLUMN serverOrderId INTEGER")
                db.execSQL("ALTER TABLE saved_bills ADD COLUMN serverOrderCode TEXT")
            }
        }

        private val MIGRATION_5_6 = object : Migration(5, 6) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE catalog_products ADD COLUMN photoUrl TEXT")
            }
        }

        private val MIGRATION_6_7 = object : Migration(6, 7) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE saved_bills ADD COLUMN orderMode TEXT NOT NULL DEFAULT 'takeaway'")
                db.execSQL("ALTER TABLE saved_bills ADD COLUMN customerName TEXT")
                db.execSQL("ALTER TABLE saved_bills ADD COLUMN tableNumber INTEGER")
            }
        }

        // Offline-first: pesanan dan shift lokal. Tabel lama dibiarkan supaya
        // transaksi yang belum terkirim dari versi sebelumnya tidak hilang.
        private val MIGRATION_7_8 = object : Migration(7, 8) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS local_orders (
                        localUuid TEXT NOT NULL PRIMARY KEY,
                        displayNumber INTEGER NOT NULL,
                        source TEXT NOT NULL,
                        serverOrderId INTEGER,
                        serverOrderCode TEXT,
                        shiftLocalUuid TEXT,
                        businessDate TEXT NOT NULL,
                        orderMode TEXT NOT NULL,
                        tableNumber INTEGER,
                        customerName TEXT,
                        notes TEXT,
                        status TEXT NOT NULL,
                        cancelReason TEXT,
                        paymentStatus TEXT NOT NULL,
                        paymentMethod TEXT,
                        paymentNotes TEXT,
                        itemsJson TEXT NOT NULL,
                        subtotal REAL NOT NULL,
                        tax REAL NOT NULL,
                        total REAL NOT NULL,
                        staffUserId INTEGER,
                        createdAtMillis INTEGER NOT NULL,
                        updatedAtMillis INTEGER NOT NULL,
                        paidAtMillis INTEGER,
                        paymentDueAtMillis INTEGER,
                        dirty INTEGER NOT NULL,
                        syncedAtMillis INTEGER
                    )
                    """.trimIndent()
                )
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS local_shifts (
                        localUuid TEXT NOT NULL PRIMARY KEY,
                        businessDate TEXT NOT NULL,
                        status TEXT NOT NULL,
                        openedAtMillis INTEGER NOT NULL,
                        closedAtMillis INTEGER,
                        openingCash REAL NOT NULL,
                        actualCash REAL,
                        openedByUserId INTEGER,
                        openedByName TEXT,
                        closedByUserId INTEGER,
                        updatedAtMillis INTEGER NOT NULL,
                        dirty INTEGER NOT NULL,
                        syncedAtMillis INTEGER
                    )
                    """.trimIndent()
                )
            }
        }

        // Katalog tablet setara menu digital: deskripsi, habis, penanda, urutan.
        private val MIGRATION_8_9 = object : Migration(8, 9) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE catalog_products ADD COLUMN description TEXT")
                db.execSQL("ALTER TABLE catalog_products ADD COLUMN availability TEXT NOT NULL DEFAULT 'available'")
                db.execSQL("ALTER TABLE catalog_products ADD COLUMN isBestSeller INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE catalog_products ADD COLUMN isFavorite INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE catalog_products ADD COLUMN sortOrder INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE catalog_products ADD COLUMN categorySortOrder INTEGER NOT NULL DEFAULT 0")
            }
        }

        private val MIGRATION_9_10 = object : Migration(9, 10) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE local_orders ADD COLUMN eventsJson TEXT NOT NULL DEFAULT '[]'")
                db.execSQL("ALTER TABLE local_shifts ADD COLUMN notes TEXT")
            }
        }

        private val MIGRATION_10_11 = object : Migration(10, 11) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE local_orders ADD COLUMN discount REAL NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE local_orders ADD COLUMN discountJson TEXT")
            }
        }

        private val MIGRATION_11_12 = object : Migration(11, 12) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE local_shifts ADD COLUMN closedByName TEXT")
                db.execSQL("ALTER TABLE local_shifts ADD COLUMN approvedByUserId INTEGER")
                db.execSQL("ALTER TABLE local_shifts ADD COLUMN approvedByName TEXT")
                db.execSQL("ALTER TABLE local_shifts ADD COLUMN cashMovementsJson TEXT")
            }
        }

        private val MIGRATION_12_13 = object : Migration(12, 13) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE catalog_products ADD COLUMN stock INTEGER")
            }
        }
    }
}
