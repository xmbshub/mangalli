package id.mangalli.pos.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Calculate
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.PointOfSale
import androidx.compose.material.icons.outlined.ReceiptLong
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em

// Kerangka ponsel (permintaan owner 14 Okt 2026): TopAppBar di atas, NavigationBar
// di bawah, isi satu kolom. Semua kontrol Material 3 bawaan; logika, data, dan
// dialog sama dengan tablet (PosUiState/PosActions), jadi perilakunya tidak bercabang.
@Composable
fun MobileApp(state: PosUiState, actions: PosActions) {
    var orderOpen by rememberSaveable { mutableStateOf(false) }
    var customAmount by rememberSaveable { mutableStateOf(false) }
    var billsOpen by rememberSaveable { mutableStateOf(false) }
    // Pesanan selesai (dibayar, disimpan, atau dikosongkan): kembali ke katalog.
    val orderEmpty = state.cart.isEmpty() && state.draft.activeBillId == null
    LaunchedEffect(orderEmpty) { if (orderEmpty) orderOpen = false }

    Box(modifier = Modifier.fillMaxSize().background(Pos.Canvas)) {
        if (state.currentStaff == null) {
            SignInScreen(state, actions)
        } else if (state.screen == Screen.Menu && orderOpen) {
            MobileOrderScreen(state, actions, onBack = { orderOpen = false })
        } else {
            BackHandler(enabled = state.screen != Screen.Menu) { actions.navigate(Screen.Menu) }
            Scaffold(
                containerColor = Pos.Canvas,
                topBar = { MobileScreenBar(state, actions, onCustomAmount = { customAmount = true }, onBills = { billsOpen = true }) },
                bottomBar = { MobileNavigation(state, actions) },
            ) { padding ->
                // Isi menyusut di atas keyboard (bilah navigasi bawah tetap di balik keyboard).
                Column(modifier = Modifier.padding(padding).consumeWindowInsets(padding).imePadding().fillMaxSize()) {
                    val banner = Modifier.padding(start = Pos.Space4, end = Pos.Space4, top = Pos.Space3)
                    clockDriftLabel(state.operations.clockOffsetMillis)?.let { drift -> ClockWarning(drift, banner) }
                    ShiftReminders(state, actions, banner)
                    state.update?.takeIf { !it.required && !it.dismissed && !it.open }?.let { UpdateBanner(it, actions, banner) }
                    Box(modifier = Modifier.weight(1f).fillMaxWidth().padding(start = Pos.Space4, end = Pos.Space4, top = Pos.Space3, bottom = Pos.Space3)) {
                        when (state.screen) {
                            Screen.Menu -> MenuScreen(state, actions, customAmount, { customAmount = it }, onOpenOrder = { orderOpen = true }, billsOpen = billsOpen, onBills = { billsOpen = it })
                            Screen.Orders -> OrdersScreen(state, actions)
                            Screen.History -> HistoryScreen(state, actions)
                            Screen.Shift -> ShiftScreen(state, actions)
                            Screen.Settings -> SettingsScreen(state, actions)
                        }
                    }
                }
            }
        }
        if (state.currentStaff != null) {
            if (state.paymentOpen) PaymentDialog(state, actions)
            state.saleResult?.let { PaymentSuccessDialog(it, actions) }
        }
        if (state.isBusy) {
            LinearProgressIndicator(
                modifier = Modifier.fillMaxWidth().height(2.dp).align(Alignment.TopCenter).statusBarsPadding(),
                color = Pos.Primary,
                trackColor = Color.Transparent,
            )
        }
        state.update?.takeIf { it.required || it.open }?.let { UpdateDialog(it, actions) }
        ToastHost(state.toast, actions::dismissToast)
    }
}

// TopAppBar Material dengan judul + satu baris keterangan, dipakai semua layar ponsel.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MobileTopBar(title: String, subtitle: String? = null, onBack: (() -> Unit)? = null, actions: @Composable RowScope.() -> Unit = {}) {
    Column {
        TopAppBar(
            title = {
                Column {
                    // Judul layar elemen terbesar (20, sama dengan tablet); keterangan 13 abu tetap terbaca di bawahnya.
                    Text(title, style = PosType.Title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (subtitle != null) Text(subtitle, style = PosType.BodySmall, color = Pos.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            },
            navigationIcon = {
                if (onBack != null) IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back") }
            },
            actions = actions,
            colors = TopAppBarDefaults.topAppBarColors(
                containerColor = Pos.Surface,
                titleContentColor = Pos.Ink,
                navigationIconContentColor = Pos.Ink,
                actionIconContentColor = Pos.Text,
            ),
        )
        HorizontalDivider(color = Pos.Line)
    }
}

@Composable
private fun MobileScreenBar(state: PosUiState, actions: PosActions, onCustomAmount: () -> Unit, onBills: () -> Unit) {
    val paidToday = state.history.filter { it.paymentStatus == "completed" && it.status != "cancelled" }.sumOf { it.total }
    val shift = state.operations.shift
    val (title, subtitle) = when (state.screen) {
        Screen.Menu -> state.outlet.name to (state.currentStaff?.let { "${it.name} · ${roleLabel(it.role)}" } ?: "")
        Screen.Orders -> "Orders" to "${state.activeOrders.size} active"
        Screen.History -> "History" to "Last 7 days · ${formatPrice(paidToday)} paid"
        Screen.Shift -> "Shift" to (shift?.let { "Open since ${clockLabel(it.openedAtMillis)} · ${it.openedByName ?: "Cashier"}" } ?: "Closed")
        Screen.Settings -> "Settings" to "Mangalli POS ${state.appVersion}"
    }
    MobileTopBar(title, subtitle) {
        when (state.screen) {
            Screen.Menu -> {
                BadgedIconButton(onClick = onBills, count = state.openBills.size) {
                    Icon(Icons.Outlined.ReceiptLong, contentDescription = "Open bills", tint = Pos.Text)
                }
                IconButton(onClick = onCustomAmount) { Icon(Icons.Outlined.Calculate, contentDescription = "Custom amount") }
            }
            Screen.Orders -> IconButton(onClick = actions::refreshOrders) { Icon(Icons.Outlined.Refresh, contentDescription = "Refresh orders") }
            else -> Unit
        }
        MobileSyncAction(state.operations, actions::syncNow)
        MobileAccountAction(state, actions)
    }
}

// Sinkron di TopAppBar: titik hijau = online (abu = offline), angka amber = perubahan
// yang belum terkirim. Ikon tetap netral supaya badge yang menonjol, bukan ikonnya.
@Composable
private fun MobileSyncAction(operations: OperationsState, onSync: () -> Unit) {
    val spin = rememberInfiniteTransition(label = "mobile-sync")
    val angle by spin.animateFloat(0f, 360f, infiniteRepeatable(tween(900, easing = LinearEasing), RepeatMode.Restart), label = "mobile-sync-angle")
    BadgedIconButton(
        onClick = onSync,
        enabled = !operations.syncing,
        count = operations.unsynced,
        dot = if (operations.isOnline) Pos.Success else Pos.Subtle,
        countColor = if (operations.isOnline) Pos.Warning else Pos.Subtle,
    ) {
        Icon(
            Icons.Outlined.Sync,
            contentDescription = when {
                operations.syncing -> "Syncing"
                operations.unsynced > 0 -> "${operations.unsynced} waiting, sync now"
                operations.isOnline -> "Online, sync now"
                else -> "Offline"
            },
            tint = if (operations.isOnline) Pos.Text else Pos.Muted,
            modifier = if (operations.syncing) Modifier.rotate(angle) else Modifier,
        )
    }
}

@Composable
private fun MobileAccountAction(state: PosUiState, actions: PosActions) {
    var open by remember { mutableStateOf(false) }
    var confirmLock by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }) { Avatar(state.currentStaff?.name ?: "?", size = 32.dp) }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, containerColor = Pos.Surface) {
            state.currentStaff?.let { staff ->
                DropdownMenuItem(
                    text = {
                        Column {
                            Text(staff.name, style = PosType.Label, color = Pos.Ink)
                            Text("${roleLabel(staff.role)} · ${state.outlet.name}", style = PosType.Caption, color = Pos.Muted)
                        }
                    },
                    onClick = {},
                    enabled = false,
                )
                HorizontalDivider(color = Pos.Line)
            }
            DropdownMenuItem(
                text = { Text("Lock and switch cashier", style = PosType.Body, color = Pos.Ink) },
                leadingIcon = { Icon(Icons.Outlined.Lock, contentDescription = null, tint = Pos.Text) },
                onClick = { open = false; confirmLock = true },
            )
        }
    }
    if (confirmLock) {
        ConfirmDialog(
            title = "Lock this phone?",
            body = "The current order stays for the next cashier.",
            confirmLabel = "Lock",
            onConfirm = actions::lock,
            onDismiss = { confirmLock = false },
            cancelLabel = "Cancel",
        )
    }
}

@Composable
private fun MobileNavigation(state: PosUiState, actions: PosActions) {
    Column {
        HorizontalDivider(color = Pos.Line)
        NavigationBar(containerColor = Pos.Surface, tonalElevation = 0.dp) {
            NavItem(state, actions, Screen.Menu, Icons.Outlined.PointOfSale, "Menu")
            NavItem(state, actions, Screen.Orders, Icons.Outlined.ReceiptLong, "Orders", badge = state.needsAttention)
            NavItem(state, actions, Screen.History, Icons.Outlined.History, "History")
            NavItem(state, actions, Screen.Shift, Icons.Outlined.Schedule, "Shift", dot = state.operations.shift == null)
            NavItem(state, actions, Screen.Settings, Icons.Outlined.Settings, "Settings")
        }
    }
}

@Composable
private fun RowScope.NavItem(state: PosUiState, actions: PosActions, screen: Screen, icon: ImageVector, label: String, badge: Int = 0, dot: Boolean = false) {
    NavigationBarItem(
        selected = state.screen == screen,
        onClick = { actions.navigate(screen) },
        icon = {
            IconWithBadge(count = badge, dot = if (dot) Pos.Warning else null) { Icon(icon, contentDescription = null) }
        },
        label = { Text(label, style = PosType.Caption.copy(fontWeight = FontWeight.Medium, letterSpacing = 0.em)) },
        colors = NavigationBarItemDefaults.colors(
            selectedIconColor = Pos.PrimaryPressed,
            selectedTextColor = Pos.Ink,
            indicatorColor = Pos.PrimarySoftStrong,
            unselectedIconColor = Pos.Muted,
            unselectedTextColor = Pos.Muted,
        ),
    )
}
