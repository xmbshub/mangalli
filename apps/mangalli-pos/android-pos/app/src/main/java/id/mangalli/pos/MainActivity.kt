package id.mangalli.pos

import android.app.ActivityManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageInstaller
import android.net.Uri
import android.media.AudioAttributes
import android.media.SoundPool
import android.content.pm.ApplicationInfo
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.core.content.ContextCompat
import androidx.activity.compose.setContent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import coil3.ImageLoader
import coil3.compose.setSingletonImageLoaderFactory
import coil3.request.crossfade
import coil3.svg.SvgDecoder
import id.mangalli.pos.network.AndroidPosApi
import id.mangalli.pos.network.BootstrapSnapshot
import id.mangalli.pos.network.DEFAULT_SYNC_TIMES
import id.mangalli.pos.network.PosApiException
import id.mangalli.pos.network.TableSnapshot
import id.mangalli.pos.offline.CartItemEntity
import id.mangalli.pos.offline.CatalogProductEntity
import id.mangalli.pos.offline.LocalOrderEntity
import id.mangalli.pos.offline.LocalShiftEntity
import id.mangalli.pos.offline.OfflineOrders
import id.mangalli.pos.offline.Qris
import id.mangalli.pos.offline.StockRules
import id.mangalli.pos.offline.DiscountSpec
import id.mangalli.pos.offline.OrderEvent
import id.mangalli.pos.offline.Promo
import id.mangalli.pos.offline.PromoLine
import id.mangalli.pos.offline.PromoRules
import id.mangalli.pos.offline.PosDatabase
import id.mangalli.pos.printer.BluetoothEscPosPrinter
import id.mangalli.pos.support.ProblemReporter
import id.mangalli.pos.printer.BluetoothPrinterStore
import id.mangalli.pos.printer.EscPos58mm
import id.mangalli.pos.printer.EscPosLogo
import id.mangalli.pos.printer.PrintLineItem
import id.mangalli.pos.printer.PrinterRole
import id.mangalli.pos.printer.SalePrintData
import id.mangalli.pos.printer.ShiftReportData
import id.mangalli.pos.security.OfflineCredentialStore
import id.mangalli.pos.security.OfflineStaff
import id.mangalli.pos.security.SecureTokenStore
import id.mangalli.pos.sync.SyncEngine
import id.mangalli.pos.ui.MANAGER_ROLES
import id.mangalli.pos.ui.AppUpdateState
import id.mangalli.pos.update.AppRelease
import id.mangalli.pos.update.AppUpdater
import id.mangalli.pos.ui.Pricing
import id.mangalli.pos.ui.PromoOption
import id.mangalli.pos.ui.MangalliTheme
import id.mangalli.pos.ui.ModifierOption
import id.mangalli.pos.ui.ORDER_MODE_DINEIN
import id.mangalli.pos.ui.ORDER_MODE_TAKEAWAY
import id.mangalli.pos.ui.OperationsState
import id.mangalli.pos.ui.OrderDraft
import id.mangalli.pos.ui.OutletInfo
import id.mangalli.pos.ui.PAYMENT_CASH
import id.mangalli.pos.ui.PaymentInput
import id.mangalli.pos.ui.PosActions
import id.mangalli.pos.ui.PosApp
import id.mangalli.pos.ui.PosUiState
import id.mangalli.pos.ui.SaleResult
import id.mangalli.pos.ui.Screen
import id.mangalli.pos.ui.ShiftSummary
import id.mangalli.pos.ui.TabletMode
import id.mangalli.pos.ui.ToastMessage
import id.mangalli.pos.ui.Tone
import id.mangalli.pos.ui.cartLineId
import id.mangalli.pos.ui.clockLabel
import id.mangalli.pos.ui.code
import id.mangalli.pos.ui.contextLabel
import id.mangalli.pos.ui.dateTimeLabel
import id.mangalli.pos.ui.displayNote
import id.mangalli.pos.ui.formatPrice
import id.mangalli.pos.ui.isCustomAmount
import id.mangalli.pos.ui.mergeCartItems
import id.mangalli.pos.ui.paymentMethodLabel
import id.mangalli.pos.ui.paymentNotes
import id.mangalli.pos.ui.shiftSummaryOf
import id.mangalli.pos.ui.statusLabel
import id.mangalli.pos.ui.toCatalogEntities
import org.json.JSONArray
import org.json.JSONObject
import java.net.URL
import java.util.Locale
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

// Tablet kasir Mangalli. Activity ini memegang data dan aturan kasir yang
// offline-first; tampilan ada di paket ui dan hanya membaca PosUiState.
// Semua kerja lokal berjalan berurutan di satu antrean supaya dua ketukan
// cepat tidak saling menimpa keranjang atau pesanan.
class MainActivity : ComponentActivity() {
    private lateinit var tokenStore: SecureTokenStore
    private lateinit var database: PosDatabase
    private lateinit var credentials: OfflineCredentialStore
    private lateinit var syncEngine: SyncEngine
    private lateinit var reporter: ProblemReporter
    private val worker = Executors.newSingleThreadExecutor()
    private val tickerHandler = Handler(Looper.getMainLooper())
    private val tickRunning = AtomicBoolean(false)
    private val menuPollRunning = AtomicBoolean(false)
    // Chime pesanan menu digital, sama dengan bunyi di dashboard.
    private val soundPool = SoundPool.Builder().setMaxStreams(1).setAudioAttributes(
        AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build(),
    ).build()
    private var orderChime = 0

    private var baseUrl by mutableStateOf(PRODUCTION_URL)
    private var debugBuild = false
    private var busyLabel by mutableStateOf<String?>(null)
    private var signInError by mutableStateOf<String?>(null)
    private var toast by mutableStateOf<ToastMessage?>(null)
    private var screen by mutableStateOf(Screen.Menu)
    private var paymentOpen by mutableStateOf(false)
    private var tabletMode by mutableStateOf(TabletMode(keepScreenOn = true, locked = false))
    private var saleResult by mutableStateOf<SaleResult?>(null)
    // Struk terakhir dibuat saat dicetak (logo diunduh saat itu), bukan saat
    // bayar, supaya pembayaran tidak menunggu jaringan.
    private var lastReceiptOrderId: String? = null

    private var currentStaff by mutableStateOf<OfflineStaff?>(null)
    private var knownStaff by mutableStateOf<List<OfflineStaff>>(emptyList())
    private var deviceRegistered by mutableStateOf(false)
    private var savedOutletKey by mutableStateOf("")

    private var outletName by mutableStateOf("Mangalli")
    private var outletAddress: String? = null
    private var outletPhone: String? = null
    private var outletLogoUrl by mutableStateOf<String?>(null)
    private var outletMenuUrl by mutableStateOf<String?>(null)
    private var outletQris by mutableStateOf<String?>(null)
    private var outletTables by mutableStateOf<List<TableSnapshot>>(emptyList())
    private var customAmountMax by mutableStateOf(10_000_000.0)
    private var syncTimes by mutableStateOf(DEFAULT_SYNC_TIMES)
    private var taxRate by mutableStateOf(OfflineOrders.taxRate)
    private var cachedLogoUrl: String? = null
    private var cachedLogoRaster: ByteArray? = null

    private var products by mutableStateOf<List<CatalogProductEntity>>(emptyList())
    private var stockLeft by mutableStateOf<Map<String, Int>>(emptyMap())
    private var cart by mutableStateOf<List<CartItemEntity>>(emptyList())
    private var orderMode by mutableStateOf(ORDER_MODE_TAKEAWAY)
    private var customerName by mutableStateOf("")
    private var tableNumber by mutableStateOf("")
    private var activeBillId by mutableStateOf<String?>(null)
    private var activeBillLabel by mutableStateOf<String?>(null)
    private var discountSpec by mutableStateOf<DiscountSpec?>(null)
    private var promotions by mutableStateOf<List<Promo>>(emptyList())
    private var outletZone: java.time.ZoneId = java.time.ZoneId.systemDefault()

    private var localOrders by mutableStateOf<List<LocalOrderEntity>>(emptyList())
    private var history by mutableStateOf<List<LocalOrderEntity>>(emptyList())
    private var shifts by mutableStateOf<List<LocalShiftEntity>>(emptyList())
    private var openShift by mutableStateOf<LocalShiftEntity?>(null)
    private var shiftSummary by mutableStateOf<ShiftSummary?>(null)
    private var isOnline by mutableStateOf(false)
    private var unsyncedCount by mutableStateOf(0)
    private var syncInProgress by mutableStateOf(false)
    private var clockOffset by mutableStateOf<Long?>(null)
    // Update dari server sendiri (AppUpdater, scripts/publish-release.ts).
    private var appUpdate by mutableStateOf<AppUpdateState?>(null)
    private var pendingRelease: AppRelease? = null
    private var lastUpdateCheck = 0L
    private val updater by lazy { AppUpdater(this) }
    private val installStatus = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
                PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                    @Suppress("DEPRECATION")
                    (intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT))?.let { startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                }
                PackageInstaller.STATUS_SUCCESS -> Unit
                else -> {
                    val message = if (status == PackageInstaller.STATUS_FAILURE_ABORTED) "The install was cancelled. Tap Try again when ready."
                    else "The update didn't install: ${intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "unknown error"}."
                    appUpdate = appUpdate?.copy(progress = null, error = message, open = true)
                }
            }
        }
    }

    private val ticker = object : Runnable {
        override fun run() {
            runTick()
            tickerHandler.postDelayed(this, TICK_MILLIS)
        }
    }

    // Pesanan menu digital dicek tiap 15 detik selama online, terpisah dari
    // ticker menit yang menjalankan sinkron terjadwal (permintaan owner 4 Okt 2026).
    private val menuPoller = object : Runnable {
        override fun run() {
            pollMenu()
            tickerHandler.postDelayed(this, MENU_POLL_MILLIS)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        orderChime = soundPool.load(this, R.raw.order_chime, 1)
        tokenStore = SecureTokenStore(this)
        database = PosDatabase.get(this)
        credentials = OfflineCredentialStore(tokenStore)
        reporter = ProblemReporter(this).also { it.install() }
        syncEngine = SyncEngine(
            context = this,
            dao = database.posDao(),
            api = { api() },
            deviceToken = { stored(KEY_DEVICE_TOKEN) },
            staffToken = { currentStaff?.staffToken ?: stored(KEY_STAFF_TOKEN) },
        )
        debugBuild = applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
        AndroidPosApi.appVersionHeader = "${installedVersionName()} (${installedVersionCode()})"
        ContextCompat.registerReceiver(this, installStatus, IntentFilter(AppUpdater.ACTION_INSTALL_STATUS), ContextCompat.RECEIVER_NOT_EXPORTED)
        // Server uji hanya untuk build debug: lewat pengaturan di layar masuk
        // atau `adb shell am start ... --es mangalli.baseUrl http://10.0.2.2:4107`
        // (tidak disimpan). Build rilis selalu ke server produksi.
        if (debugBuild) {
            baseUrl = intent?.getStringExtra("mangalli.baseUrl")?.takeIf { it.startsWith("http") } ?: stored(KEY_BASE_URL) ?: PRODUCTION_URL
        }
        loadStoredOutlet()
        currentStaff = stored(KEY_CURRENT_STAFF_EMAIL)?.let { email -> credentials.knownStaff().firstOrNull { it.email == email } }

        setContent {
            setSingletonImageLoaderFactory { context ->
                ImageLoader.Builder(context).components { add(SvgDecoder.Factory()) }.crossfade(true).build()
            }
            MangalliTheme {
                PosApp(state = uiState(), actions = actions)
            }
        }
        refresh()
        applyTabletMode()
        if (tabletMode.locked && !isPinned()) requestPin()
    }

    override fun onStart() {
        super.onStart()
        tickerHandler.removeCallbacks(ticker)
        tickerHandler.post(ticker)
        tickerHandler.removeCallbacks(menuPoller)
        tickerHandler.postDelayed(menuPoller, MENU_POLL_MILLIS)
        // Crash sesi sebelumnya langsung dilaporkan bila tablet online.
        if (reporter.pendingCrash() != null) Thread { if (syncEngine.isOnline()) runCatching { flushCrash() } }.start()
        Thread { if (syncEngine.isOnline()) checkForUpdate(manual = false) }.start()
    }

    override fun onResume() {
        super.onResume()
        applyTabletMode()
    }

    // Mode tablet disimpan per perangkat. Kunci memakai screen pinning Android:
    // tombol Home/Recent dan notifikasi tertahan sampai dibuka dari Settings.
    // Android selalu meminta konfirmasi ("Got it"); bila ditolak atau dilepas
    // dengan gerakan sistem, status di Settings ikut kembali ke tidak terkunci.
    // Setelah tablet restart, kunci dipasang lagi saat Mangalli dibuka.
    private fun applyTabletMode() {
        val prefs = getSharedPreferences(TABLET_PREFS, MODE_PRIVATE)
        tabletMode = TabletMode(prefs.getBoolean("keep_screen_on", true), prefs.getBoolean("locked", false), prefs.getBoolean("order_sound", true))
        if (tabletMode.keepScreenOn) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    private fun isPinned() = getSystemService(ActivityManager::class.java).lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE

    private var pinRequestedAt = 0L

    private fun requestPin() {
        pinRequestedAt = System.currentTimeMillis()
        runCatching { startLockTask() }
        tickerHandler.removeCallbacks(pinWatcher)
        tickerHandler.postDelayed(pinWatcher, 3_000)
    }

    private val pinWatcher = object : Runnable {
        override fun run() {
            if (!tabletMode.locked) return
            val waiting = System.currentTimeMillis() - pinRequestedAt < 20_000
            if (!isPinned() && !waiting) { saveTabletMode(locked = false); return }
            tickerHandler.postDelayed(this, 3_000)
        }
    }

    private fun saveTabletMode(keepScreenOn: Boolean = tabletMode.keepScreenOn, locked: Boolean = tabletMode.locked, orderSound: Boolean = tabletMode.orderSound) {
        getSharedPreferences(TABLET_PREFS, MODE_PRIVATE).edit().putBoolean("keep_screen_on", keepScreenOn).putBoolean("locked", locked)
            .putBoolean("order_sound", orderSound).apply()
        applyTabletMode()
    }

    override fun onDestroy() {
        runCatching { unregisterReceiver(installStatus) }
        soundPool.release()
        super.onDestroy()
    }

    override fun onStop() {
        tickerHandler.removeCallbacks(ticker)
        tickerHandler.removeCallbacks(menuPoller)
        super.onStop()
    }

    private fun uiState(): PosUiState = PosUiState(
        screen = screen,
        currentStaff = currentStaff,
        deviceRegistered = deviceRegistered,
        knownStaff = knownStaff,
        savedOutletKey = savedOutletKey,
        serverHost = runCatching { URL(baseUrl).let { if (it.port > 0) "${it.host}:${it.port}" else it.host } }.getOrDefault(baseUrl),
        debugBuild = debugBuild,
        appVersion = runCatching { packageManager.getPackageInfo(packageName, 0).versionName }.getOrNull() ?: "",
        busy = busyLabel,
        signInError = signInError,
        toast = toast,
        outlet = OutletInfo(
            name = outletName,
            logoUrl = outletLogoUrl,
            outletKey = savedOutletKey,
            taxRate = taxRate,
            syncTimes = syncTimes,
            tables = outletTables,
            menuUrl = outletMenuUrl,
            qrisPayload = outletQris?.takeIf { Qris.merchantName(it) != null },
            customAmountMax = customAmountMax,
        ),
        products = products,
        stockLeft = stockLeft,
        cart = cart,
        draft = OrderDraft(orderMode, customerName, tableNumber, activeBillId, activeBillLabel),
        orders = localOrders,
        history = history,
        shifts = shifts,
        operations = OperationsState(
            shift = openShift,
            summary = shiftSummary,
            isOnline = isOnline,
            unsynced = unsyncedCount,
            syncing = syncInProgress,
            lastSync = syncEngine.lastSyncMillis.takeIf { it > 0 },
            lastSyncMessage = syncEngine.lastSyncMessage,
            nextSync = OfflineOrders.nextScheduled(syncTimes, System.currentTimeMillis()),
            clockOffsetMillis = clockOffset,
        ),
        paymentOpen = paymentOpen,
        saleResult = saleResult,
        tabletMode = tabletMode,
        update = appUpdate,
        pricing = pricingFor(cart),
        promoOptions = promoLines(cart).let { lines ->
            val now = System.currentTimeMillis()
            // Kupon tidak ditampilkan di daftar; kasir mengetik kodenya.
            promotions.filter { it.code == null && PromoRules.isLive(it, now, outletZone) }.map { PromoOption(it, PromoRules.discount(it, lines)) }
        },
    )

    // ---------- Diskon ----------

    private fun promoLines(items: List<CartItemEntity>): List<PromoLine> {
        val categories = products.associate { it.id to it.categoryName }
        return items.map { PromoLine(it.productId.takeUnless { id -> id.startsWith("custom:") }, categories[it.productId], it.price * it.quantity) }
    }

    private fun orderPromoLines(items: List<id.mangalli.pos.offline.LocalOrderItem>): List<PromoLine> {
        val categories = products.associate { it.id to it.categoryName }
        return items.map { PromoLine(it.productId.takeUnless { _ -> it.isCustomAmount }, categories[it.productId], it.unitPrice * it.quantity) }
    }

    // Satu perhitungan harga untuk panel pesanan, pembayaran, dan penyimpanan.
    private fun pricingFor(items: List<CartItemEntity>): Pricing {
        val subtotal = items.sumOf { it.price * it.quantity }
        val discount = PromoRules.amountFor(discountSpec, promotions, promoLines(items)).coerceAtMost(subtotal)
        return Pricing(subtotal, discount, discountSpec?.label?.takeIf { discount > 0 }, OfflineOrders.taxAfterDiscount(subtotal, discount), OfflineOrders.totalAfterDiscount(subtotal, discount))
    }

    // Diskon manual tercatat sekali sebagai kejadian pesanan (audit + penyetuju).
    private fun withDiscountEvent(eventsJson: String, spec: DiscountSpec?, amount: Double): String {
        if (spec == null || !spec.manual || spec.eventId == null || amount <= 0) return eventsJson
        if (OfflineOrders.eventsFromJson(eventsJson).any { it.id == spec.eventId }) return eventsJson
        return OfflineOrders.withEvent(eventsJson, OrderEvent(spec.eventId, "discount", "${spec.label} (${formatPrice(amount)})", spec.reason, amount, spec.byUserId, spec.approvedByUserId, System.currentTimeMillis()))
    }

    // ---------- Antrean kerja ----------

    private fun showToast(text: String, tone: Tone = Tone.Success) {
        runOnUiThread { toast = ToastMessage(System.nanoTime(), text, tone) }
    }

    // Kerja lokal cepat (keranjang, draft): tanpa indikator sibuk.
    private fun quick(block: () -> Unit) {
        worker.execute {
            runCatching(block).onFailure {
                reporter.noteError(it.message ?: "Something went wrong.")
                showToast(it.message ?: "Something went wrong.", Tone.Danger)
            }
            refreshNow()
        }
    }

    // Kerja yang ditunggu kasir (bayar, shift, masuk): indikator sibuk dan
    // pesan hasil. Kesalahan masuk tampil di formulir, lainnya sebagai toast.
    private fun task(label: String, signIn: Boolean = false, onResult: ((String?) -> Unit)? = null, block: () -> String?) {
        if (busyLabel != null) return
        busyLabel = label
        if (signIn) signInError = null
        worker.execute {
            val result = runCatching(block)
            refreshNow()
            runOnUiThread {
                busyLabel = null
                result.onSuccess { message ->
                    onResult?.invoke(null)
                    if (!message.isNullOrBlank()) showToast(message)
                }
                result.onFailure { error ->
                    val message = error.message ?: "Something went wrong."
                    reporter.noteError("$label: $message")
                    when {
                        onResult != null -> onResult(message)
                        signIn -> signInError = message
                        else -> showToast(message, Tone.Danger)
                    }
                }
            }
        }
    }

    private fun refresh() = worker.execute { refreshNow() }

    private fun refreshNow() {
        val dao = database.posDao()
        val nextProducts = dao.products()
        val rawCart = dao.cartItems()
        val nextCart = mergeCartItems(rawCart)
        if (rawCart != nextCart) {
            dao.clearCart()
            nextCart.forEach(dao::saveCartItem)
        }
        val now = System.currentTimeMillis()
        val nextOrders = dao.recentOrders(now - RECENT_WINDOW_MILLIS)
        val nextHistory = dao.ordersSince(now - HISTORY_WINDOW_MILLIS)
        val nextShifts = dao.recentShifts(30)
        val nextShift = dao.openShift()
        val nextSummary = nextShift?.let { shiftSummaryOf(it, dao.shiftOrders(it.localUuid)) }
        val nextUnsynced = dao.dirtyOrderCount() + dao.dirtyShifts().size + dao.pendingSyncCount()
        val nextStaff = credentials.knownStaff()
        val registered = !stored(KEY_DEVICE_TOKEN).isNullOrBlank()
        val nextStock = StockRules.left(nextProducts, dao.unsyncedPosOrders(), nextCart, activeBillId)
        runOnUiThread {
            products = nextProducts
            stockLeft = nextStock
            cart = nextCart
            localOrders = nextOrders
            history = nextHistory
            shifts = nextShifts
            openShift = nextShift
            shiftSummary = nextSummary
            unsyncedCount = nextUnsynced
            knownStaff = nextStaff
            deviceRegistered = registered
            clockOffset = AndroidPosApi.clockOffsetMillis
            if (activeBillId != null && nextOrders.none { it.localUuid == activeBillId && it.paymentStatus == "pending" }) {
                activeBillId = null
                activeBillLabel = null
            }
        }
    }

    // ---------- Sinkron ----------

    // Tiap menit: cek koneksi, ambil pesanan menu digital bila online, kirim
    // perubahannya, dan jalankan sinkron penuh bila jam terjadwal lewat.
    private fun runTick() {
        if (!tickRunning.compareAndSet(false, true)) return
        Thread {
            try {
                val online = syncEngine.isOnline()
                runOnUiThread { isOnline = online }
                if (online && currentStaff != null && !stored(KEY_DEVICE_TOKEN).isNullOrBlank()) {
                    if (OfflineOrders.isSyncDue(syncTimes, syncEngine.lastSyncMillis, System.currentTimeMillis())) runSync("scheduled")
                }
            } catch (_: Throwable) {
                // Pemeriksaan latar belakang tidak pernah menghentikan kasir.
            } finally {
                tickRunning.set(false)
                refresh()
            }
        }.start()
    }

    private fun pollMenu() {
        if (currentStaff == null || stored(KEY_DEVICE_TOKEN).isNullOrBlank()) return
        if (!menuPollRunning.compareAndSet(false, true)) return
        Thread {
            try {
                if (!syncEngine.isOnline()) return@Thread
                val poll = runCatching { syncEngine.pollMenuOrders() }.getOrNull()
                runCatching { syncEngine.pushMenuUpdates() }
                if (poll != null && poll.newPending + poll.paidElsewhere > 0) {
                    if (tabletMode.orderSound && orderChime != 0) soundPool.play(orderChime, 1f, 1f, 1, 0, 1f)
                    showToast(menuPollMessage(poll), Tone.Info)
                    refresh()
                }
            } catch (_: Throwable) {
                // Pemeriksaan latar belakang tidak pernah menghentikan kasir.
            } finally {
                menuPollRunning.set(false)
            }
        }.start()
    }

    private fun menuPollMessage(poll: id.mangalli.pos.sync.MenuPoll): String = when {
        poll.paidElsewhere == 0 -> if (poll.newPending == 1) "New digital menu order awaiting payment." else "${poll.newPending} new digital menu orders awaiting payment."
        poll.newPending == 0 -> if (poll.paidElsewhere == 1) "A digital menu order was paid and is ready for the kitchen." else "${poll.paidElsewhere} digital menu orders were paid and are ready for the kitchen."
        else -> "${poll.newPending} new and ${poll.paidElsewhere} paid digital menu orders."
    }

    private fun runSync(reason: String): Result<String> {
        runOnUiThread { syncInProgress = true }
        val result = runCatching {
            syncEngine.syncNow(reason) { flushLegacyQueue() }.also { outcome ->
                outcome.snapshot?.let(::saveCatalogSnapshot)
                // Data yang ditolak server tidak pernah sampai ke laporan: jadikan laporan masalah.
                if (outcome.rejected.isNotEmpty()) runCatching {
                    sendReport("sync", "${outcome.rejected.size} item(s) couldn't sync", outcome.rejected.joinToString("\n").take(3000), "sync:" + outcome.rejected.first().substringAfter(": ").take(60))
                }
                runCatching { flushCrash() }
            }.message
        }
        // Sinkron yang berhasil membuktikan tablet online; tanpa ini label tetap
        // "Offline" sampai pemeriksaan per menit berikutnya.
        val online = result.isSuccess || syncEngine.isOnline()
        runOnUiThread { syncInProgress = false; isOnline = online }
        refresh()
        if (result.isSuccess) runCatching { checkForUpdate(manual = false) }
        return result
    }

    // ---------- Laporan masalah ----------

    private fun reportContext(): Map<String, Any?> = mapOf(
        "appVersion" to runCatching { packageManager.getPackageInfo(packageName, 0).versionName }.getOrNull(),
        "android" to "${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})",
        "model" to "${Build.MANUFACTURER} ${Build.MODEL}",
        "cashier" to currentStaff?.name,
        "unsynced" to unsyncedCount,
        "lastSync" to syncEngine.lastSyncMessage?.take(300),
        "clockOffsetMin" to AndroidPosApi.clockOffsetMillis?.let { it / 60_000 },
        "receiptPrinter" to (BluetoothPrinterStore(this).name(PrinterRole.RECEIPT) ?: "not set"),
        "kitchenPrinter" to (BluetoothPrinterStore(this).name(PrinterRole.KITCHEN) ?: "not set"),
        "recentErrors" to reporter.recentErrors().ifBlank { null },
    )

    private fun sendReport(category: String, title: String, message: String?, fingerprint: String? = null, extra: Map<String, Any?> = emptyMap()) {
        val device = stored(KEY_DEVICE_TOKEN) ?: error("Connect this tablet to an outlet first.")
        val context = JSONObject().also { json -> (reportContext() + extra).forEach { (key, value) -> json.put(key, value ?: JSONObject.NULL) } }
        api().report(
            device, currentStaff?.staffToken,
            JSONObject().put("category", category).put("title", title.take(160)).put("message", message?.take(4000) ?: JSONObject.NULL)
                .put("fingerprint", fingerprint ?: JSONObject.NULL).put("context", context),
        )
    }

    // Crash dari sesi sebelumnya dikirim begitu tablet online lagi.
    private fun flushCrash() {
        val crash = reporter.pendingCrash() ?: return
        sendReport("crash", crash.optString("title", "App crashed"), crash.optString("stack"), crash.optString("fingerprint").ifBlank { null }, mapOf("crashedAt" to crash.optString("at")))
        reporter.clearCrash()
    }

    private fun flushLegacyQueue(): Int {
        val deviceToken = stored(KEY_DEVICE_TOKEN) ?: return 0
        val staffToken = currentStaff?.staffToken ?: stored(KEY_STAFF_TOKEN) ?: return 0
        var sent = 0
        database.posDao().pendingSyncEvents().forEach { event ->
            val result = runCatching { api().syncQueuedOrder(deviceToken, staffToken, event.localUuid, event.idempotencyKey, event.payloadJson) }.getOrNull()
            if (result?.success == true) {
                database.posDao().markSynced(event.localUuid, System.currentTimeMillis())
                sent += 1
            }
        }
        return sent
    }

    private fun saveCatalogSnapshot(snapshot: BootstrapSnapshot) {
        if (outletLogoUrl != snapshot.outletLogoUrl) {
            cachedLogoUrl = null
            cachedLogoRaster = null
        }
        tokenStore.save(KEY_OUTLET_NAME, snapshot.outletName)
        tokenStore.save(KEY_OUTLET_ADDRESS, snapshot.outletAddress.orEmpty())
        tokenStore.save(KEY_OUTLET_PHONE, snapshot.outletPhone.orEmpty())
        tokenStore.save(KEY_OUTLET_LOGO_URL, snapshot.outletLogoUrl.orEmpty())
        tokenStore.save(KEY_MENU_URL, snapshot.menuUrl.orEmpty())
        tokenStore.save(KEY_QRIS, snapshot.qrisPayload.orEmpty())
        tokenStore.save(KEY_SYNC_TIMES, snapshot.syncTimes.joinToString(","))
        tokenStore.save(KEY_TAX_RATE, snapshot.taxRate.toString())
        tokenStore.save(KEY_CUSTOM_MAX, snapshot.customAmountMax.toString())
        tokenStore.save(KEY_PROMOTIONS, snapshot.promotionsJson)
        credentials.saveApprovers(snapshot.approversJson)
        tokenStore.save(KEY_TIMEZONE, snapshot.timezone)
        tokenStore.save(KEY_TABLES, JSONArray().also { rows ->
            snapshot.tables.forEach { rows.put(JSONObject().put("code", it.code).put("label", it.label).put("area", it.area)) }
        }.toString())
        database.posDao().replaceProducts(snapshot.products.toCatalogEntities())
        runOnUiThread { loadStoredOutlet() }
    }

    private fun loadStoredOutlet() {
        savedOutletKey = stored(KEY_OUTLET_KEY).orEmpty()
        outletName = stored(KEY_OUTLET_NAME) ?: "Mangalli"
        outletAddress = stored(KEY_OUTLET_ADDRESS)
        outletPhone = stored(KEY_OUTLET_PHONE)
        outletLogoUrl = stored(KEY_OUTLET_LOGO_URL)
        outletMenuUrl = stored(KEY_MENU_URL)
        outletQris = stored(KEY_QRIS)
        syncTimes = stored(KEY_SYNC_TIMES)?.split(',')?.filter(String::isNotBlank)?.ifEmpty { null } ?: DEFAULT_SYNC_TIMES
        customAmountMax = stored(KEY_CUSTOM_MAX)?.toDoubleOrNull() ?: 10_000_000.0
        OfflineOrders.taxRate = stored(KEY_TAX_RATE)?.toDoubleOrNull()?.coerceIn(0.0, 0.25) ?: OfflineOrders.taxRate
        taxRate = OfflineOrders.taxRate
        promotions = PromoRules.parse(stored(KEY_PROMOTIONS))
        outletZone = runCatching { java.time.ZoneId.of(stored(KEY_TIMEZONE) ?: "") }.getOrDefault(java.time.ZoneId.systemDefault())
        outletTables = runCatching {
            val rows = JSONArray(stored(KEY_TABLES) ?: "[]")
            (0 until rows.length()).map { rows.getJSONObject(it).let { row -> TableSnapshot(row.optString("code"), row.optString("label"), row.optString("area")) } }
        }.getOrDefault(emptyList())
    }

    // ---------- Pesanan ----------

    private fun requireStaff(): OfflineStaff = currentStaff ?: error("Sign in as a cashier first.")

    private fun requireOpenShift(): LocalShiftEntity = database.posDao().openShift() ?: error("Open a shift first.")

    // Persetujuan: owner/manager menyetujui sendiri; kasir butuh PIN persetujuan
    // manager/owner (bukan password, jadi password yang bocor tidak bisa menyetujui).
    // Dicek offline; 5 PIN salah mengunci persetujuan 1 menit.
    private fun approverFor(staff: OfflineStaff, pin: String): OfflineStaff {
        if (staff.role in MANAGER_ROLES) return staff
        check(credentials.hasApprovalPins()) { "No approval PIN on this tablet yet. The owner sets one in the dashboard under Team, then tap Sync now." }
        val now = System.currentTimeMillis()
        check(now >= pinLockedUntil) { "Too many wrong PINs. Try again in a minute." }
        val approver = credentials.approverByPin(pin)
        if (approver == null) {
            wrongPins += 1
            if (wrongPins >= 5) { wrongPins = 0; pinLockedUntil = now + 60_000 }
            error("Manager PIN is incorrect.")
        }
        wrongPins = 0
        return approver
    }

    private var wrongPins = 0
    private var pinLockedUntil = 0L

    // Item yang sudah tersimpan di bill hanya boleh berkurang lewat Void, yang
    // meminta alasan dan persetujuan serta tercatat di audit log.
    private fun checkNoSilentVoid(existing: LocalOrderEntity?, items: List<id.mangalli.pos.offline.LocalOrderItem>) {
        if (existing == null || existing.source != "pos") return
        val next = items.associate { it.cartLineId to it.quantity }
        val removed = OfflineOrders.itemsFromJson(existing.itemsJson).firstOrNull { (next[it.cartLineId] ?: 0) < it.quantity }
        check(removed == null) { "${removed?.name} is already on the bill. Use Void to remove it." }
    }

    private fun orderEvent(type: String, summary: String, reason: String?, amount: Double, staff: OfflineStaff, approver: OfflineStaff?) = OrderEvent(
        id = UUID.randomUUID().toString(), type = type, summary = summary, reason = reason?.trim()?.take(200)?.ifBlank { null }, amount = amount,
        byUserId = staff.userId, approvedByUserId = approver?.userId?.takeIf { it != staff.userId }, atMillis = System.currentTimeMillis(),
    )

    // Meja dari dashboard (Tables & QR, lewat sinkron) adalah patokan; nomor
    // yang tidak ada di sana ditolak, sama seperti menu digital dan server.
    private fun tableProblem(): String? {
        if (orderMode != ORDER_MODE_DINEIN) return null
        val number = tableNumber.trim().toIntOrNull()?.takeIf { it > 0 } ?: return "Choose a table for dine-in orders."
        val known = outletTables.mapNotNull { it.number }
        return when {
            known.isEmpty() -> "No tables in the dashboard yet. Add them under Tables & QR, then tap Sync now."
            number !in known -> "Table $number isn't in the dashboard. Choose another table."
            else -> null
        }
    }

    private fun draftTable(): Int? {
        tableProblem()?.let { error(it) }
        return if (orderMode == ORDER_MODE_DINEIN) tableNumber.trim().toInt() else null
    }

    // Bill terbuka disimpan di tablet sebagai pesanan belum bayar yang masuk
    // antrean dapur. Tambahan item pada bill lama kembali ke dapur.
    private fun saveCartAsBill(): LocalOrderEntity {
        val dao = database.posDao()
        val currentCart = dao.cartItems()
        check(currentCart.isNotEmpty()) { "The order is empty." }
        checkStock()
        val staff = requireStaff()
        val shift = requireOpenShift()
        val table = draftTable()
        val now = System.currentTimeMillis()
        val existing = activeBillId?.let(dao::order)
        val items = OfflineOrders.itemsFromCart(currentCart, existing?.let { OfflineOrders.itemsFromJson(it.itemsJson) } ?: emptyList())
        checkNoSilentVoid(existing, items)
        val subtotal = OfflineOrders.subtotal(items)
        val spec = discountSpec
        val discount = PromoRules.amountFor(spec, promotions, orderPromoLines(items)).coerceAtMost(subtotal)
        val businessDate = existing?.businessDate ?: shift.businessDate
        val order = LocalOrderEntity(
            localUuid = existing?.localUuid ?: UUID.randomUUID().toString(),
            displayNumber = existing?.displayNumber ?: (dao.lastDisplayNumber(businessDate) + 1),
            source = existing?.source ?: "pos",
            serverOrderId = existing?.serverOrderId,
            serverOrderCode = existing?.serverOrderCode,
            shiftLocalUuid = existing?.shiftLocalUuid ?: shift.localUuid,
            businessDate = businessDate,
            orderMode = orderMode,
            tableNumber = table,
            customerName = customerName.trim().take(80).ifBlank { null },
            notes = existing?.notes,
            status = when {
                existing == null -> "accepted"
                existing.status == "ready" && items.any { it.pendingKitchenQuantity > 0 } -> "accepted"
                else -> existing.status
            },
            cancelReason = null,
            paymentStatus = "pending",
            paymentMethod = null,
            paymentNotes = null,
            itemsJson = OfflineOrders.itemsToJson(items),
            subtotal = subtotal,
            tax = OfflineOrders.taxAfterDiscount(subtotal, discount),
            total = OfflineOrders.totalAfterDiscount(subtotal, discount),
            staffUserId = existing?.staffUserId ?: staff.userId,
            createdAtMillis = existing?.createdAtMillis ?: now,
            updatedAtMillis = now,
            paidAtMillis = null,
            paymentDueAtMillis = null,
            dirty = true,
            syncedAtMillis = existing?.syncedAtMillis,
            eventsJson = withDiscountEvent(existing?.eventsJson ?: "[]", spec, discount),
            discount = discount,
            discountJson = spec?.takeIf { discount > 0 }?.toJson(),
        )
        dao.saveOrder(order)
        return order
    }

    // Cetak item dapur yang belum dicetak bila printer dapur sudah diatur.
    // Gagal cetak tidak membatalkan pesanan; kasir diberi tahu.
    private fun sendToKitchen(order: LocalOrderEntity): Int {
        val address = BluetoothPrinterStore(this).address(PrinterRole.KITCHEN)
        val items = OfflineOrders.itemsFromJson(order.itemsJson)
        val pending = items.filter { it.pendingKitchenQuantity > 0 }
        if (address.isNullOrBlank() || pending.isEmpty()) return 0
        return runCatching {
            BluetoothEscPosPrinter(this).print(address, EscPos58mm.ticket(kitchenPrintData(order, pending)))
            database.posDao().saveOrder(order.copy(itemsJson = OfflineOrders.itemsToJson(OfflineOrders.markAllPrinted(items)), updatedAtMillis = System.currentTimeMillis(), dirty = true))
            pending.sumOf { it.pendingKitchenQuantity }
        }.getOrElse {
            showToast("Kitchen ticket didn't print: ${it.message}", Tone.Warning)
            0
        }
    }

    private fun resetDraft() {
        database.posDao().clearCart()
        runOnUiThread {
            orderMode = ORDER_MODE_TAKEAWAY
            customerName = ""
            tableNumber = ""
            activeBillId = null
            activeBillLabel = null
            discountSpec = null
        }
    }

    // Sisa stok sekarang (stok server − penjualan belum sinkron − keranjang); negatif = kelebihan.
    private fun stockLeftNow(): Map<String, Int> {
        val dao = database.posDao()
        return StockRules.left(dao.products(), dao.unsyncedPosOrders(), dao.cartItems(), activeBillId)
    }

    private fun checkStock() {
        val over = stockLeftNow().entries.firstOrNull { it.value < 0 } ?: return
        val product = database.posDao().products().firstOrNull { it.id == over.key }
        val have = (database.posDao().cartItems().filter { it.productId == over.key }.sumOf { it.quantity } + over.value).coerceAtLeast(0)
        error(if (have > 0) "Only $have ${product?.name ?: "left"} left. Lower the quantity." else "${product?.name ?: "An item"} is sold out. Remove it from the order.")
    }

    private fun charge(input: PaymentInput): String {
        val dao = database.posDao()
        val currentCart = dao.cartItems()
        check(currentCart.isNotEmpty()) { "The order is empty." }
        checkStock()
        val staff = requireStaff()
        val shift = requireOpenShift()
        val table = draftTable()
        val now = System.currentTimeMillis()
        val existing = activeBillId?.let(dao::order)
        val items = OfflineOrders.itemsFromCart(currentCart, existing?.let { OfflineOrders.itemsFromJson(it.itemsJson) } ?: emptyList())
        checkNoSilentVoid(existing, items)
        val subtotal = OfflineOrders.subtotal(items)
        val spec = discountSpec
        val discount = PromoRules.amountFor(spec, promotions, orderPromoLines(items)).coerceAtMost(subtotal)
        val total = OfflineOrders.totalAfterDiscount(subtotal, discount)
        if (input.method == PAYMENT_CASH) check(input.tendered >= total) { "Cash received is less than the total." }
        val businessDate = existing?.businessDate ?: shift.businessDate
        val hasKitchenItems = items.any { !it.isCustomAmount }
        val order = LocalOrderEntity(
            localUuid = existing?.localUuid ?: UUID.randomUUID().toString(),
            displayNumber = existing?.displayNumber ?: (dao.lastDisplayNumber(businessDate) + 1),
            source = "pos",
            serverOrderId = existing?.serverOrderId,
            serverOrderCode = existing?.serverOrderCode,
            // Uang masuk ke laci shift yang menerimanya, bukan shift pembuka bill.
            shiftLocalUuid = shift.localUuid,
            businessDate = businessDate,
            orderMode = orderMode,
            tableNumber = table,
            customerName = customerName.trim().take(80).ifBlank { null },
            notes = existing?.notes,
            // Pesanan berisi menu dapur masuk antrean dapur; custom amount saja langsung selesai.
            status = when {
                existing != null && existing.status in setOf("accepted", "preparing", "ready", "new") -> existing.status
                hasKitchenItems -> "accepted"
                else -> "completed"
            },
            cancelReason = null,
            paymentStatus = "completed",
            paymentMethod = input.method,
            paymentNotes = paymentNotes(input, total),
            itemsJson = OfflineOrders.itemsToJson(items),
            subtotal = subtotal,
            tax = OfflineOrders.taxAfterDiscount(subtotal, discount),
            total = total,
            staffUserId = existing?.staffUserId ?: staff.userId,
            createdAtMillis = existing?.createdAtMillis ?: now,
            updatedAtMillis = now,
            paidAtMillis = now,
            paymentDueAtMillis = null,
            dirty = true,
            syncedAtMillis = existing?.syncedAtMillis,
            eventsJson = withDiscountEvent(existing?.eventsJson ?: "[]", spec, discount),
            discount = discount,
            discountJson = spec?.takeIf { discount > 0 }?.toJson(),
        )
        dao.saveOrder(order)
        lastReceiptOrderId = order.localUuid
        sendToKitchen(order)
        resetDraft()
        runOnUiThread {
            paymentOpen = false
            saleResult = SaleResult(order.code(), total, paymentMethodLabel(input.method), if (input.method == PAYMENT_CASH) input.tendered - total else null)
        }
        return ""
    }

    private fun kitchenPrintData(order: LocalOrderEntity, items: List<id.mangalli.pos.offline.LocalOrderItem>) = SalePrintData(
        outletName = outletName,
        outletAddress = outletAddress,
        outletPhone = outletPhone,
        outletLogoRaster = logoRaster(),
        reference = order.code(),
        customerName = order.customerName ?: if (order.orderMode == ORDER_MODE_DINEIN) "Table ${order.tableNumber ?: "-"}" else "Walk-in",
        orderContext = if (order.orderMode == ORDER_MODE_DINEIN) "Dine in - Table ${order.tableNumber ?: "-"}" else "Takeaway",
        items = items.map { PrintLineItem(it.name, it.pendingKitchenQuantity.takeIf { q -> q > 0 } ?: it.quantity, it.unitPrice, it.modifierSummary, displayNote(it.notes)) },
        subtotal = 0.0,
        tax = 0.0,
        total = 0.0,
    )

    // QRIS dinamis untuk total (dibulatkan ke rupiah); null bila QRIS toko belum diatur.
    private fun qrisFor(total: Double): String? = Qris.dynamic(outletQris, Math.round(total))

    private fun salePrintData(order: LocalOrderEntity, paymentLabel: String?, withQris: Boolean = false) = SalePrintData(
        outletName = outletName,
        outletAddress = outletAddress,
        outletPhone = outletPhone,
        outletLogoRaster = logoRaster(),
        reference = order.code(),
        customerName = order.customerName ?: if (order.orderMode == ORDER_MODE_DINEIN) "Table ${order.tableNumber ?: "-"}" else "Walk-in",
        orderContext = if (order.orderMode == ORDER_MODE_DINEIN) "Dine in - Table ${order.tableNumber ?: "-"}" else "Takeaway",
        items = OfflineOrders.itemsFromJson(order.itemsJson).map {
            PrintLineItem(it.name, it.quantity, it.unitPrice, it.modifierSummary, displayNote(it.notes), sendToKitchen = !it.isCustomAmount)
        },
        subtotal = order.subtotal,
        tax = order.tax,
        total = order.total,
        paymentLabel = paymentLabel,
        discount = order.discount,
        discountLabel = DiscountSpec.fromJson(order.discountJson)?.label,
        qrisPayload = if (withQris) qrisFor(order.total) else null,
        qrisMerchant = if (withQris) Qris.merchantName(outletQris) else null,
    )

    private fun logoRaster(): ByteArray? {
        val configured = outletLogoUrl?.takeIf(String::isNotBlank) ?: return null
        val absolute = runCatching { URL(URL("${baseUrl.trimEnd('/')}/"), configured.trimStart('/')).toString() }.getOrNull() ?: return null
        if (cachedLogoUrl == absolute) return cachedLogoRaster
        cachedLogoUrl = absolute
        cachedLogoRaster = runCatching { EscPosLogo.downloadRaster(absolute) }.getOrNull()
        return cachedLogoRaster
    }

    private fun print(role: PrinterRole, document: ByteArray, label: String): String {
        val address = BluetoothPrinterStore(this).address(role)
            ?: error("Set up the ${if (role == PrinterRole.KITCHEN) "kitchen" else "receipt"} printer in Settings first.")
        BluetoothEscPosPrinter(this).print(address, document)
        return "$label printed."
    }

    private fun stored(key: String): String? = runCatching { tokenStore.read(key) }.getOrNull()?.takeIf { it.isNotBlank() }

    private fun api(): AndroidPosApi = AndroidPosApi(baseUrl)

    // ---------- Update aplikasi ----------

    private fun installedVersionCode(): Long = runCatching { packageManager.getPackageInfo(packageName, 0).longVersionCode }.getOrDefault(0L)
    private fun installedVersionName(): String = runCatching { packageManager.getPackageInfo(packageName, 0).versionName }.getOrNull() ?: ""

    // Dicek saat aplikasi dibuka dan setelah sinkron (paling sering 30 menit
    // sekali), atau manual dari Settings. Dijalankan di thread latar.
    private fun checkForUpdate(manual: Boolean) {
        val now = System.currentTimeMillis()
        if (!manual && now - lastUpdateCheck < UPDATE_CHECK_MILLIS) return
        lastUpdateCheck = now
        val release = runCatching { api().appUpdate() }.getOrElse { failure ->
            if (manual) showToast("Couldn't check for updates: ${failure.message}", Tone.Warning)
            return
        }
        val current = installedVersionCode()
        val newer = release?.takeIf { it.versionCode > current }
        runOnUiThread {
            pendingRelease = newer
            appUpdate = newer?.let { found ->
                val previous = appUpdate?.takeIf { it.versionName == found.versionName }
                AppUpdateState(
                    versionName = found.versionName,
                    notes = found.notes,
                    required = current < found.minVersionCode,
                    open = previous?.open ?: manual,
                    dismissed = previous?.dismissed ?: false,
                    progress = previous?.progress,
                    error = previous?.error,
                )
            }
        }
        if (manual && newer == null) showToast("Mangalli is up to date.")
    }

    private fun startUpdate() {
        val release = pendingRelease ?: return
        if (appUpdate?.progress != null) return
        if (!updater.canInstall()) {
            appUpdate = appUpdate?.copy(open = true, error = "Allow Mangalli to install updates in the screen that opened, then tap Try again.")
            runCatching { startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName"))) }
            return
        }
        appUpdate = appUpdate?.copy(open = true, progress = 0f, error = null)
        Thread {
            var shown = 0
            runCatching {
                val apk = updater.download(release) { progress ->
                    val percent = (progress * 100).toInt()
                    if (percent != shown) { shown = percent; runOnUiThread { appUpdate = appUpdate?.copy(progress = progress) } }
                }
                runOnUiThread { appUpdate = appUpdate?.copy(progress = 1f) }
                // Mode kunci (screen pinning) menahan layar installer Android.
                if (isPinned()) runOnUiThread { runCatching { stopLockTask() } }
                updater.install(apk)
            }.onFailure { failure ->
                runOnUiThread { appUpdate = appUpdate?.copy(progress = null, error = failure.message ?: "The update failed. Try again.") }
            }
        }.start()
    }

    private fun deviceKey(): String =
        Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID) ?: "android-pos-${System.currentTimeMillis()}"

    // ---------- Aksi dari UI ----------

    private val actions = object : PosActions {
        override fun navigate(screen: Screen) {
            this@MainActivity.screen = screen
            if (screen == Screen.Orders) refreshOrders()
        }

        override fun dismissToast() {
            toast = null
        }

        override fun checkForUpdate() {
            Thread { this@MainActivity.checkForUpdate(manual = true) }.start()
        }

        override fun openUpdate() {
            appUpdate = appUpdate?.copy(open = true)
        }

        override fun dismissUpdate() {
            appUpdate = appUpdate?.copy(open = false, dismissed = true, error = null)
        }

        override fun startUpdate() = this@MainActivity.startUpdate()

        override fun syncNow() {
            if (syncInProgress) return
            Thread {
                runSync("manual")
                    .onSuccess { showToast(it) }
                    .onFailure { showToast("Sync postponed: ${it.message}", Tone.Warning) }
            }.start()
        }

        // Masuk kasir: bila pernah masuk online di tablet ini, diverifikasi di
        // tablet tanpa internet. Masuk pertama atau akun baru butuh internet.
        override fun signIn(outletKey: String, email: String, password: String) = task("Signing in", signIn = true) {
            val normalizedEmail = email.trim().lowercase(Locale.ROOT)
            val offline = if (!stored(KEY_DEVICE_TOKEN).isNullOrBlank()) credentials.verify(normalizedEmail, password) else null
            if (offline != null) {
                tokenStore.save(KEY_STAFF_TOKEN, offline.staffToken)
                tokenStore.save(KEY_CURRENT_STAFF_EMAIL, offline.email)
                val next = if (database.posDao().openShift() == null) Screen.Shift else Screen.Menu
                runOnUiThread {
                    currentStaff = offline
                    screen = next
                }
                return@task "Welcome back, ${offline.name}."
            }
            if (!syncEngine.isOnline()) {
                val known = credentials.knownStaff().any { it.email == normalizedEmail }
                error(if (known) "Wrong password." else "This tablet is offline. The first sign-in needs internet.")
            }
            val login = runCatching { api().deviceLogin(outletKey = outletKey.trim(), email = normalizedEmail, password = password, deviceKey = deviceKey()) }
                .getOrElse { failure ->
                    val status = (failure as? PosApiException)?.status
                    error(
                        when {
                            status == null -> "Couldn't reach the Mangalli server. Check the internet connection."
                            status == 401 || status == 403 || status == 422 -> "Outlet code, email, or password is incorrect."
                            else -> failure.message ?: "Sign-in failed."
                        },
                    )
                }
            val previousOutlet = stored(KEY_OUTLET_KEY)
            check(previousOutlet == null || previousOutlet == login.outletKey) { "This tablet is connected to $previousOutlet. Disconnect it in Settings first." }
            tokenStore.save(KEY_DEVICE_TOKEN, login.deviceToken)
            tokenStore.save(KEY_STAFF_TOKEN, login.staffToken)
            tokenStore.save(KEY_OUTLET_KEY, login.outletKey)
            if (debugBuild) tokenStore.save(KEY_BASE_URL, baseUrl)
            val staff = OfflineStaff(login.userId, login.staffName, normalizedEmail, login.posRole, login.staffToken)
            credentials.remember(staff, password)
            tokenStore.save(KEY_CURRENT_STAFF_EMAIL, staff.email)
            saveCatalogSnapshot(api().bootstrap(login.deviceToken, login.staffToken))
            val next = if (database.posDao().openShift() == null) Screen.Shift else Screen.Menu
            runOnUiThread {
                currentStaff = staff
                screen = next
            }
            "Signed in as ${login.staffName}. The menu is saved for offline use."
        }

        override fun lock() {
            tokenStore.save(KEY_CURRENT_STAFF_EMAIL, "")
            currentStaff = null
            paymentOpen = false
            signInError = null
            screen = Screen.Menu
        }

        override fun forgetStaff(email: String) = quick {
            val staff = currentStaff
            check(staff == null || staff.email.equals(email, ignoreCase = true) || staff.role in MANAGER_ROLES) { "Only an owner or manager can remove another cashier." }
            credentials.forget(email)
            showToast("Removed from this tablet.")
        }

        // Putus hubungan: tablet kembali ke layar hubungkan. Hanya owner/manager;
        // data yang belum tersinkron ikut terhapus (sudah diperingatkan di UI).
        override fun disconnectDevice() = task("Disconnecting") {
            val dao = database.posDao()
            check(requireStaff().role in setOf("owner", "manager")) { "Only an owner or manager can disconnect this tablet." }
            dao.clearCart()
            dao.clearProducts()
            dao.clearSavedBills()
            dao.clearOrders()
            dao.clearShifts()
            tokenStore.clearAll()
            getSharedPreferences("mangalli_sync", MODE_PRIVATE).edit().clear().apply()
            runOnUiThread {
                currentStaff = null
                baseUrl = PRODUCTION_URL
                loadStoredOutlet()
                screen = Screen.Menu
            }
            "Tablet disconnected."
        }

        override fun setServer(url: String) {
            if (!debugBuild || deviceRegistered) return
            baseUrl = url.trim().trimEnd('/')
            tokenStore.save(KEY_BASE_URL, baseUrl)
        }

        override fun addProduct(product: CatalogProductEntity, options: List<ModifierOption>, quantity: Int, notes: String, replaceLineId: String?) = quick {
            check(!product.isSoldOut) { "${product.name} is sold out." }
            val dao = database.posDao()
            val cleanedNotes = notes.trim().take(255)
            val lineId = cartLineId(product.id, options.map { it.id }, cleanedNotes)
            val existing = dao.cartItem(lineId)
            val nextQuantity = if (replaceLineId == lineId) quantity else (existing?.quantity ?: 0) + quantity
            // Stok dari dashboard: dicek sebelum keranjang diubah, supaya baris yang
            // sedang diedit tidak hilang bila stok tidak cukup.
            val replaced = replaceLineId?.takeIf { it != lineId }?.let { dao.cartItem(it)?.quantity } ?: 0
            stockLeftNow()[product.id]?.let { left ->
                val added = nextQuantity - (existing?.quantity ?: 0) - replaced
                check(added <= left) { if (left + replaced > 0) "Only ${left + replaced + (existing?.quantity ?: 0)} ${product.name} left." else "${product.name} is sold out." }
            }
            if (replaceLineId != null && replaceLineId != lineId) dao.deleteCartItem(replaceLineId)
            val modifierTotal = options.sumOf { it.priceDelta }
            dao.saveCartItem(
                CartItemEntity(
                    cartLineId = lineId,
                    productId = product.id,
                    name = product.name,
                    price = product.price + modifierTotal,
                    quantity = nextQuantity.coerceIn(1, 99),
                    modifierOptionIdsJson = JSONArray(options.map { it.id }).toString(),
                    modifierSummary = options.joinToString(", ") { it.name }.ifBlank { null },
                    modifierTotal = modifierTotal,
                    notes = cleanedNotes.ifBlank { null },
                )
            )
        }

        override fun changeQuantity(item: CartItemEntity, delta: Int) = quick {
            val dao = database.posDao()
            if (delta > 0) stockLeftNow()[item.productId]?.let { left -> check(delta <= left) { if (left > 0) "Only $left ${item.name} left." else "No more ${item.name} in stock." } }
            val next = item.quantity + delta
            if (next <= 0) dao.deleteCartItem(item.cartLineId) else dao.saveCartItem(item.copy(quantity = next.coerceAtMost(99)))
        }

        override fun removeItem(item: CartItemEntity) = quick { database.posDao().deleteCartItem(item.cartLineId) }

        override fun clearOrder() = quick { resetDraft() }

        override fun applyCoupon(code: String) {
            val clean = PromoRules.normalizeCode(code)
            val promo = promotions.firstOrNull { it.code != null && it.code == clean }
            val problem = PromoRules.couponProblem(promo, promoLines(cart), System.currentTimeMillis(), outletZone)
            if (problem != null || promo == null) {
                showToast(problem ?: "This coupon code isn't valid.", Tone.Danger)
                return
            }
            discountSpec = DiscountSpec(promoId = promo.id, label = "${promo.name} (${promo.code})")
            showToast("Coupon ${promo.code} applied.")
        }

        override fun applyPromo(promoId: Long?) {
            discountSpec = promoId?.let { id -> promotions.firstOrNull { it.id == id }?.let { DiscountSpec(promoId = it.id, label = it.name) } }
        }

        // Diskon manual: alasan wajib; kasir butuh password manager/owner.
        override fun applyManualDiscount(kind: String, value: Double, reason: String, approvalPassword: String, onResult: ((String?) -> Unit)?) = task("Applying discount", onResult = onResult) {
            val staff = requireStaff()
            check(reason.isNotBlank()) { "Give a reason for the discount." }
            check(value > 0 && (kind != "percent" || value <= 100)) { if (kind == "percent") "Enter 1 to 100%." else "Enter the discount in rupiah." }
            val approver = approverFor(staff, approvalPassword)
            val label = if (kind == "percent") "Discount ${if (value % 1.0 == 0.0) value.toLong() else value}%" else "Discount ${formatPrice(value)}"
            val spec = DiscountSpec(label = label, kind = kind, value = value, reason = reason.trim().take(200), byUserId = staff.userId,
                approvedByUserId = approver.userId.takeIf { it != staff.userId }, eventId = UUID.randomUUID().toString())
            runOnUiThread { discountSpec = spec }
            "$label applied${if (approver.userId != staff.userId) " · approved by ${approver.name}" else ""}."
        }

        // Void item pada bill tersimpan: alasan wajib, kasir butuh persetujuan.
        override fun voidItem(item: CartItemEntity, quantity: Int, reason: String, approvalPassword: String, onResult: ((String?) -> Unit)?) = task("Voiding item", onResult = onResult) {
            val dao = database.posDao()
            val staff = requireStaff()
            val bill = activeBillId?.let(dao::order) ?: error("Only items on a saved bill need a void.")
            val saved = OfflineOrders.itemsFromJson(bill.itemsJson)
            val line = saved.firstOrNull { it.cartLineId == item.cartLineId } ?: error("This item isn't on the saved bill.")
            val keep = quantity.coerceIn(0, line.quantity - 1)
            val remaining = saved.mapNotNull {
                when {
                    it.cartLineId != line.cartLineId -> it
                    keep == 0 -> null
                    else -> it.copy(quantity = keep, kitchenPrintedQuantity = minOf(it.kitchenPrintedQuantity, keep))
                }
            }
            check(remaining.isNotEmpty()) { "This is the last item. Cancel the order from Orders instead." }
            check(reason.isNotBlank()) { "Give a reason for the void." }
            val approver = approverFor(staff, approvalPassword)
            val voided = line.quantity - keep
            val amount = voided * line.unitPrice
            val subtotal = OfflineOrders.subtotal(remaining)
            val billDiscount = PromoRules.amountFor(DiscountSpec.fromJson(bill.discountJson), promotions, orderPromoLines(remaining)).coerceAtMost(subtotal)
            val event = orderEvent("void", "Void ${voided}× ${line.name} (${formatPrice(amount)})", reason, amount, staff, approver)
            dao.saveOrder(
                bill.copy(
                    itemsJson = OfflineOrders.itemsToJson(remaining), subtotal = subtotal, tax = OfflineOrders.taxAfterDiscount(subtotal, billDiscount),
                    total = OfflineOrders.totalAfterDiscount(subtotal, billDiscount), discount = billDiscount, eventsJson = OfflineOrders.withEvent(bill.eventsJson, event),
                    updatedAtMillis = event.atMillis, dirty = true,
                )
            )
            if (keep == 0) dao.deleteCartItem(item.cartLineId) else dao.saveCartItem(item.copy(quantity = keep))
            "Voided ${voided}× ${line.name}${if (approver.userId != staff.userId) " · approved by ${approver.name}" else ""}."
        }

        override fun addCustomAmount(label: String, amount: Double) = quick {
            check(amount > 0 && amount <= customAmountMax) { "Enter an amount up to ${formatPrice(customAmountMax)}." }
            val lineId = "custom:${UUID.randomUUID()}"
            database.posDao().saveCartItem(CartItemEntity(lineId, lineId, label.take(80), amount, 1, "[]", null, 0.0, null))
            showToast("$label added.")
        }

        override fun setOrderMode(mode: String) {
            orderMode = mode
        }

        override fun setCustomerName(name: String) {
            customerName = name
        }

        override fun setTable(number: String) {
            tableNumber = number.filter(Char::isDigit).take(4)
        }

        override fun saveBill() = task("Saving bill") {
            val order = saveCartAsBill()
            val printed = sendToKitchen(order)
            resetDraft()
            "Bill saved · ${order.contextLabel()}${if (printed > 0) " · sent to kitchen" else ""}."
        }

        override fun openBill(localUuid: String) = quick {
            val dao = database.posDao()
            val order = dao.order(localUuid) ?: error("This bill is no longer available.")
            dao.clearCart()
            mergeCartItems(OfflineOrders.cartFromItems(OfflineOrders.itemsFromJson(order.itemsJson))).forEach(dao::saveCartItem)
            runOnUiThread {
                activeBillId = order.localUuid
                activeBillLabel = order.contextLabel()
                orderMode = order.orderMode
                customerName = order.customerName.orEmpty()
                tableNumber = order.tableNumber?.toString().orEmpty()
                discountSpec = DiscountSpec.fromJson(order.discountJson)
                screen = Screen.Menu
            }
        }

        override fun updateBillAndPrintNewItems() = task("Updating bill") {
            val order = saveCartAsBill()
            val printed = sendToKitchen(order)
            resetDraft()
            if (printed > 0) "Bill updated · $printed new item(s) sent to the kitchen." else "Bill updated."
        }

        override fun printBill() = task("Printing bill") {
            val order = saveCartAsBill()
            print(PrinterRole.RECEIPT, EscPos58mm.bill(salePrintData(order, null, withQris = true)), "Bill")
        }

        override fun printQris(amount: Double, reference: String, context: String, onResult: ((String?) -> Unit)?) = task("Printing QRIS", onResult = onResult) {
            val payload = qrisFor(amount) ?: error("Upload the store QRIS in the dashboard (Outlet settings), then sync this tablet.")
            val slip = SalePrintData(
                outletName = outletName, outletAddress = outletAddress, outletPhone = outletPhone, outletLogoRaster = logoRaster(),
                reference = reference, customerName = "", orderContext = context, items = emptyList(),
                subtotal = amount, tax = 0.0, total = amount, qrisPayload = payload, qrisMerchant = Qris.merchantName(outletQris),
            )
            print(PrinterRole.RECEIPT, EscPos58mm.qrisSlip(slip), "QRIS")
        }

        override fun openPayment(open: Boolean) {
            if (!open) {
                paymentOpen = false
                return
            }
            when {
                openShift == null -> {
                    showToast("Open a shift to take payments.", Tone.Warning)
                    screen = Screen.Shift
                }
                tableProblem() != null -> showToast(tableProblem()!!, Tone.Warning)
                else -> paymentOpen = true
            }
        }

        override fun charge(input: PaymentInput) = task("Processing payment") { this@MainActivity.charge(input) }

        override fun setKeepScreenOn(on: Boolean) = saveTabletMode(keepScreenOn = on)

        override fun setOrderSound(on: Boolean) {
            saveTabletMode(orderSound = on)
            if (on && orderChime != 0) soundPool.play(orderChime, 1f, 1f, 1, 0, 1f)
        }

        override fun lockTablet() {
            saveTabletMode(locked = true)
            requestPin()
        }

        // Kasir butuh PIN manager untuk membuka kunci; owner/manager langsung.
        override fun unlockTablet(approvalPin: String, onResult: ((String?) -> Unit)?) = task("Unlocking", onResult = onResult) {
            approverFor(requireStaff(), approvalPin)
            runOnUiThread {
                saveTabletMode(locked = false)
                runCatching { stopLockTask() }
            }
            "Tablet unlocked. Home and other apps work again."
        }

        // "New order" selalu kembali ke layar Menu, juga setelah membayar dari Orders.
        override fun closeSaleResult() {
            saleResult = null
            screen = Screen.Menu
        }

        override fun printLastReceipt() = task("Printing receipt") {
            val order = lastReceiptOrderId?.let(database.posDao()::order) ?: error("No receipt to print.")
            print(PrinterRole.RECEIPT, EscPos58mm.receipt(salePrintData(order, paymentMethodLabel(order.paymentMethod))), "Receipt")
        }

        override fun refreshOrders() {
            Thread {
                if (syncEngine.isOnline()) runCatching { syncEngine.pollMenuOrders() }
                refresh()
            }.start()
        }

        override fun updateOrderStatus(localUuid: String, status: String, approvalPassword: String, reason: String, onResult: ((String?) -> Unit)?) = task("Updating order", onResult = onResult) {
            val dao = database.posDao()
            val entity = dao.order(localUuid) ?: error("Order not found on this tablet.")
            val staff = requireStaff()
            val cancelling = status == "cancelled"
            val paid = entity.paymentStatus == "completed"
            // Membatalkan pesanan yang sudah dibayar (refund) atau sudah diproses dapur butuh persetujuan.
            val approver = if (cancelling && (paid || entity.status !in setOf("new", "pending_payment"))) approverFor(staff, approvalPassword) else null
            if (cancelling) check(reason.isNotBlank()) { "Give a reason for the cancellation." }
            val event = if (cancelling) orderEvent(
                "cancel",
                if (paid) "Refunded ${formatPrice(entity.total)} (${paymentMethodLabel(entity.paymentMethod)})" else "Cancelled, ${formatPrice(entity.total)} unpaid",
                reason, entity.total, staff, approver,
            ) else null
            dao.saveOrder(
                entity.copy(
                    eventsJson = event?.let { OfflineOrders.withEvent(entity.eventsJson, it) } ?: entity.eventsJson,
                    status = status,
                    cancelReason = if (status == "cancelled") reason.trim().ifBlank { "Cancelled at the cashier." } else entity.cancelReason,
                    paymentStatus = if (status == "cancelled" && entity.paymentStatus != "completed") "cancelled" else entity.paymentStatus,
                    updatedAtMillis = System.currentTimeMillis(),
                    dirty = true,
                )
            )
            if (entity.source == "menu") Thread { runCatching { syncEngine.pushMenuUpdates() } }.start()
            "${entity.code()}: ${statusLabel(status).lowercase(Locale.ROOT)}."
        }

        // Terima pembayaran: pesanan menu digital masuk dapur (tiket dicetak),
        // atau open bill yang siap ditutup.
        override fun settleOrder(localUuid: String, input: PaymentInput) = task("Recording payment") {
            val dao = database.posDao()
            val entity = dao.order(localUuid) ?: error("Order not found on this tablet.")
            val shift = requireOpenShift()
            if (input.method == PAYMENT_CASH) check(input.tendered >= entity.total) { "Cash received is less than the total." }
            val now = System.currentTimeMillis()
            val menuPayment = entity.source == "menu" && entity.status == "pending_payment"
            val updated = entity.copy(
                status = when {
                    menuPayment -> "new"
                    entity.status == "ready" -> "completed"
                    else -> entity.status
                },
                paymentStatus = "completed",
                paymentMethod = input.method,
                paymentNotes = paymentNotes(input, entity.total),
                paidAtMillis = now,
                // Uang masuk ke laci shift yang menerimanya.
                shiftLocalUuid = shift.localUuid,
                updatedAtMillis = now,
                dirty = true,
            )
            dao.saveOrder(updated)
            lastReceiptOrderId = updated.localUuid
            if (menuPayment) {
                sendToKitchen(updated)
                Thread { runCatching { syncEngine.pushMenuUpdates() } }.start()
            }
            val change = if (input.method == PAYMENT_CASH) input.tendered - entity.total else null
            runOnUiThread { saleResult = SaleResult(updated.code(), entity.total, paymentMethodLabel(input.method), change) }
            ""
        }

        // Cetak ulang dari Orders/History selalu bertanda COPY.
        override fun printOrderReceipt(localUuid: String) = task("Printing receipt") {
            val order = database.posDao().order(localUuid) ?: error("Order not found on this tablet.")
            print(PrinterRole.RECEIPT, EscPos58mm.receipt(salePrintData(order, paymentMethodLabel(order.paymentMethod)).copy(isCopy = true)), "Receipt")
        }

        override fun openShift(openingCash: Double) = task("Opening shift") {
            val staff = requireStaff()
            val dao = database.posDao()
            check(dao.openShift() == null) { "A shift is already open." }
            val now = System.currentTimeMillis()
            val shiftId = UUID.randomUUID().toString()
            // Bill yang belum dibayar dari shift sebelumnya pindah ke shift ini.
            val carried = dao.unpaidBills()
            carried.forEach { dao.saveOrder(it.copy(shiftLocalUuid = shiftId, updatedAtMillis = now, dirty = true)) }
            dao.saveShift(
                LocalShiftEntity(
                    localUuid = shiftId,
                    businessDate = OfflineOrders.businessDate(now),
                    status = "open",
                    openedAtMillis = now,
                    closedAtMillis = null,
                    openingCash = openingCash.coerceAtLeast(0.0),
                    actualCash = null,
                    openedByUserId = staff.userId,
                    openedByName = staff.name,
                    closedByUserId = null,
                    updatedAtMillis = now,
                    dirty = true,
                    syncedAtMillis = null,
                )
            )
            runOnUiThread { screen = Screen.Menu }
            "Shift opened with ${formatPrice(openingCash)} starting cash.${if (carried.isNotEmpty()) " ${carried.size} open bill(s) moved to this shift." else ""}"
        }

        // Tutup shift: selisih kas wajib dijelaskan. Kasir butuh PIN manager/owner
        // bila kas kurang atau bill terbuka dibawa ke shift berikutnya.
        override fun closeShift(countedCash: Double, note: String, approvalPassword: String, onResult: ((String?) -> Unit)?) = task("Closing shift", onResult = onResult) {
            val staff = requireStaff()
            val dao = database.posDao()
            val shift = dao.openShift() ?: error("No shift is open.")
            val orders = dao.shiftOrders(shift.localUuid)
            val open = orders.filter { it.source == "pos" && it.paymentStatus == "pending" && it.status != "cancelled" }
            val difference = countedCash - shiftSummaryOf(shift, orders).expectedCash
            check(kotlin.math.abs(difference) < 1 || note.isNotBlank()) { "Explain the cash difference before closing." }
            val approver = if (open.isNotEmpty() || difference <= -1) approverFor(staff, approvalPassword) else null
            val approvedBy = approver?.takeIf { it.userId != staff.userId }
            val notes = listOfNotNull(
                note.trim().take(300).ifBlank { null },
                if (open.isEmpty()) null else "${open.size} open bill(s), ${formatPrice(open.sumOf { it.total })}, carried to the next shift" +
                    if (approvedBy != null) " (approved by ${approvedBy.name})" else "",
            ).joinToString(" · ").ifBlank { null }
            val now = System.currentTimeMillis()
            dao.saveShift(shift.copy(status = "closed", closedAtMillis = now, actualCash = countedCash.coerceAtLeast(0.0), closedByUserId = staff.userId, closedByName = staff.name,
                approvedByUserId = approvedBy?.userId, approvedByName = approvedBy?.name, updatedAtMillis = now, dirty = true, notes = notes))
            // Tutup shift selalu mencoba sinkron; bila offline, laporan terkirim di sinkron berikutnya.
            syncNow()
            "Shift closed."
        }

        // Cash in/out: uang keluar/masuk laci di luar penjualan. Cash out oleh kasir
        // butuh PIN manager/owner; semuanya ikut sinkron dan tercatat di audit log.
        override fun recordCash(kind: String, amount: Double, reason: String, approvalPin: String, onResult: ((String?) -> Unit)?) = task(if (kind == "out") "Recording cash out" else "Recording cash in", onResult = onResult) {
            val staff = requireStaff()
            val dao = database.posDao()
            val shift = dao.openShift() ?: error("Open a shift first.")
            check(kind == "in" || kind == "out") { "Choose cash in or cash out." }
            check(amount >= 1 && amount <= 100_000_000) { "Enter the amount." }
            check(reason.isNotBlank()) { "Write what the money was for." }
            if (kind == "out") {
                val expected = shiftSummaryOf(shift, dao.shiftOrders(shift.localUuid)).expectedCash
                check(amount <= expected) { "The drawer should only have ${formatPrice(expected)}." }
            }
            val approver = if (kind == "out") approverFor(staff, approvalPin).takeIf { it.userId != staff.userId } else null
            val movement = id.mangalli.pos.offline.CashMovement(
                id = UUID.randomUUID().toString(), kind = kind, amount = amount, reason = reason.trim().take(200),
                byUserId = staff.userId, byName = staff.name, approvedByUserId = approver?.userId, approvedByName = approver?.name,
                atMillis = System.currentTimeMillis(),
            )
            val movements = OfflineOrders.cashMovementsFromJson(shift.cashMovementsJson) + movement
            dao.saveShift(shift.copy(cashMovementsJson = OfflineOrders.cashMovementsToJson(movements), updatedAtMillis = System.currentTimeMillis(), dirty = true))
            "${if (kind == "out") "Cash out" else "Cash in"} ${formatPrice(amount)} recorded${approver?.let { " · approved by ${it.name}" } ?: ""}."
        }

        override fun reportProblem(category: String, message: String) = task("Sending report") {
            check(message.trim().length >= 5) { "Describe what happened in a few words." }
            sendReport(category, message.trim().split(Regex("(?<=[.!?])\\s|\n")).first().trimEnd('.', '!', '?').take(120), message.trim())
            runCatching { flushCrash() }
            "Report sent. The owner sees it under Support on the dashboard."
        }

        override fun printShiftReport(localUuid: String) = task("Printing report") {
            val dao = database.posDao()
            val shift = dao.recentShifts(60).firstOrNull { it.localUuid == localUuid } ?: error("Shift not found on this tablet.")
            val summary = shiftSummaryOf(shift, dao.shiftOrders(shift.localUuid))
            print(
                PrinterRole.RECEIPT,
                EscPos58mm.shiftReport(
                    ShiftReportData(
                        outletName = outletName,
                        businessDate = shift.businessDate,
                        openedAt = dateTimeLabel(shift.openedAtMillis),
                        closedAt = shift.closedAtMillis?.let(::clockLabel) ?: "Open",
                        openedBy = shift.openedByName ?: "-",
                        closedBy = shift.closedByName ?: credentials.knownStaff().firstOrNull { it.userId == shift.closedByUserId }?.name ?: "-",
                        approvedBy = shift.approvedByName,
                        note = shift.notes,
                        paidOrders = summary.orderCount,
                        cancelledOrders = summary.cancelledCount,
                        cashSales = summary.cashSales,
                        nonCashSales = summary.nonCashSales,
                        openingCash = shift.openingCash,
                        expectedCash = summary.expectedCash,
                        countedCash = shift.actualCash,
                        cashMovements = OfflineOrders.cashMovementsFromJson(shift.cashMovementsJson).map { it.reason.take(18) to it.signed },
                    )
                ),
                "Shift report",
            )
        }
    }

    companion object {
        private const val PRODUCTION_URL = BuildConfig.SERVER_URL
        // Alamat server uji build debug. Kunci lama "base_url" sengaja tidak dibaca
        // lagi supaya tablet yang pernah diarahkan ke server uji kembali ke produksi.
        private const val KEY_BASE_URL = "debug_server_url"
        private const val UPDATE_CHECK_MILLIS = 30 * 60_000L
        private const val KEY_DEVICE_TOKEN = "device_token"
        private const val KEY_STAFF_TOKEN = "staff_token"
        private const val KEY_CURRENT_STAFF_EMAIL = "current_staff_email"
        private const val KEY_OUTLET_KEY = "outlet_key"
        private const val KEY_OUTLET_NAME = "outlet_name"
        private const val KEY_OUTLET_ADDRESS = "outlet_address"
        private const val KEY_OUTLET_PHONE = "outlet_phone"
        private const val KEY_OUTLET_LOGO_URL = "outlet_logo_url"
        private const val KEY_MENU_URL = "menu_url"
        private const val KEY_QRIS = "qris_payload"
        private const val KEY_SYNC_TIMES = "sync_times"
        private const val KEY_TAX_RATE = "tax_rate"
        private const val KEY_CUSTOM_MAX = "custom_amount_max"
        private const val KEY_TABLES = "tables"
        private const val KEY_PROMOTIONS = "promotions"
        private const val TABLET_PREFS = "tablet_mode"
        private const val KEY_TIMEZONE = "outlet_timezone"
        private const val TICK_MILLIS = 60_000L
        private const val MENU_POLL_MILLIS = 15_000L
        private const val RECENT_WINDOW_MILLIS = 3L * 24 * 60 * 60 * 1000
        private const val HISTORY_WINDOW_MILLIS = 7L * 24 * 60 * 60 * 1000
    }
}
