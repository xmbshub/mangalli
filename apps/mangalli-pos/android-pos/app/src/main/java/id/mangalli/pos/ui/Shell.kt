package id.mangalli.pos.ui

import android.content.Intent
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.PointOfSale
import androidx.compose.material.icons.outlined.ReceiptLong
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import id.mangalli.pos.R

// Akar UI tablet. Tanpa kasir yang masuk, hanya layar masuk yang tampil.
@Composable
fun PosApp(state: PosUiState, actions: PosActions) {
    Box(modifier = Modifier.fillMaxSize().background(Pos.Canvas)) {
        if (state.currentStaff == null) {
            SignInScreen(state, actions)
        } else {
            // Tombol kembali membawa kasir ke Menu dulu, bukan menutup aplikasi.
            BackHandler(enabled = state.screen != Screen.Menu) { actions.navigate(Screen.Menu) }
            Row(modifier = Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
                NavRail(state, actions)
                Column(modifier = Modifier.weight(1f).fillMaxHeight()) {
                clockDriftLabel(state.operations.clockOffsetMillis)?.let { drift -> ClockWarning(drift) }
                state.update?.takeIf { !it.required && !it.dismissed && !it.open }?.let { UpdateBanner(it, actions) }
                Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                    AnimatedContent(
                        targetState = state.screen,
                        // Layar lama langsung hilang: crossfade menumpuk dua layar dan meninggalkan "bayangan".
                        transitionSpec = { fadeIn(tween(120)) togetherWith ExitTransition.None },
                        label = "screen",
                    ) { screen ->
                        Box(modifier = Modifier.fillMaxSize().padding(Pos.Space4)) {
                            when (screen) {
                                Screen.Menu -> MenuScreen(state, actions)
                                Screen.Orders -> OrdersScreen(state, actions)
                                Screen.History -> HistoryScreen(state, actions)
                                Screen.Shift -> ShiftScreen(state, actions)
                                Screen.Settings -> SettingsScreen(state, actions)
                            }
                        }
                    }
                }
                }
            }
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
        // Update wajib tampil juga di layar masuk; yang opsional hanya saat dibuka.
        state.update?.takeIf { it.required || it.open }?.let { UpdateDialog(it, actions) }
        ToastHost(state.toast, actions::dismissToast)
    }
}

@Composable
private fun NavRail(state: PosUiState, actions: PosActions) {
    var confirmLock by remember { mutableStateOf(false) }
    // Rail mengambang seperti panel dan dialog (keputusan owner 4 Okt 2026):
    // 16 dp dari tepi layar (sejajar dengan isi layar), sudut kartu, bayangan tipis.
    Column(
        modifier = Modifier
            .padding(start = Pos.Space4, top = Pos.Space4, bottom = Pos.Space4)
            .width(88.dp)
            .fillMaxHeight()
            .shadow(10.dp, RoundedCornerShape(Pos.RadiusCard), ambientColor = Color.Black.copy(alpha = 0.06f), spotColor = Color.Black.copy(alpha = 0.10f))
            .clip(RoundedCornerShape(Pos.RadiusCard))
            .background(Pos.Surface)
            .border(1.dp, Pos.Line, RoundedCornerShape(Pos.RadiusCard))
            .padding(vertical = Pos.Space4),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            modifier = Modifier.size(48.dp).clip(RoundedCornerShape(Pos.Radius)).background(Pos.Surface).border(1.dp, Pos.Line, RoundedCornerShape(Pos.Radius)),
            contentAlignment = Alignment.Center,
        ) {
            Image(painterResource(R.drawable.mangalli_logo), contentDescription = "Mangalli", modifier = Modifier.size(32.dp))
        }
        Spacer(Modifier.height(Pos.Space6))
        Column(verticalArrangement = Arrangement.spacedBy(Pos.Space2), horizontalAlignment = Alignment.CenterHorizontally) {
            RailItem(Icons.Outlined.PointOfSale, "Menu", state.screen == Screen.Menu) { actions.navigate(Screen.Menu) }
            RailItem(Icons.Outlined.ReceiptLong, "Orders", state.screen == Screen.Orders, badge = state.needsAttention) { actions.navigate(Screen.Orders) }
            RailItem(Icons.Outlined.History, "History", state.screen == Screen.History) { actions.navigate(Screen.History) }
            RailItem(Icons.Outlined.Schedule, "Shift", state.screen == Screen.Shift, dot = if (state.operations.shift == null) Pos.Warning else null) { actions.navigate(Screen.Shift) }
            RailItem(Icons.Outlined.Settings, "Settings", state.screen == Screen.Settings) { actions.navigate(Screen.Settings) }
        }
        Spacer(Modifier.weight(1f))
        SyncButton(state.operations, actions::syncNow)
        Spacer(Modifier.height(Pos.Space4))
        // Lencana gembok di luar lingkaran avatar: clip hanya untuk area ketuk
        // avatar, supaya lencana tidak terpotong bingkai bulat.
        val lockInteraction = remember { MutableInteractionSource() }
        Box(modifier = Modifier.pressable(lockInteraction).clickable(interactionSource = lockInteraction, indication = null) { confirmLock = true }) {
            Avatar(state.currentStaff?.name ?: "?", size = 44.dp)
            Box(
                modifier = Modifier.align(Alignment.BottomEnd).offset(x = 3.dp, y = 3.dp).size(20.dp).clip(CircleShape).background(Pos.Surface).border(1.dp, Pos.Line, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Outlined.Lock, contentDescription = "Lock tablet", tint = Pos.Muted, modifier = Modifier.size(12.dp))
            }
        }
    }
    if (confirmLock) {
        ConfirmDialog(
            title = "Lock this tablet?",
            body = "The current order stays for the next cashier.",
            confirmLabel = "Lock",
            onConfirm = actions::lock,
            onDismiss = { confirmLock = false },
            cancelLabel = "Cancel",
        )
    }
}

@Composable
private fun RailItem(icon: ImageVector, label: String, selected: Boolean, badge: Int = 0, dot: Color? = null, onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val background by animateColorAsState(if (selected) Pos.PrimarySoftStrong else Color.Transparent, Pos.QuickColor, label = "rail-bg")
    val foreground by animateColorAsState(if (selected) Pos.PrimaryPressed else Pos.Muted, Pos.QuickColor, label = "rail-fg")
    Column(
        modifier = Modifier
            .width(72.dp)
            .pressable(interaction)
            .clip(RoundedCornerShape(Pos.Radius))
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(vertical = Pos.Space2),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Box {
            Box(modifier = Modifier.width(52.dp).height(32.dp).clip(CircleShape).background(background), contentAlignment = Alignment.Center) {
                Icon(icon, contentDescription = null, tint = foreground, modifier = Modifier.size(22.dp))
            }
            if (badge > 0) CountBadge(badge, modifier = Modifier.align(Alignment.TopEnd))
            else if (dot != null) StatusDot(dot, modifier = Modifier.align(Alignment.TopEnd).padding(top = 2.dp, end = 8.dp))
        }
        Text(label, style = if (selected) PosType.Micro else PosType.Micro.copy(fontWeight = PosType.Body.fontWeight), color = if (selected) Pos.Ink else Pos.Muted, textAlign = TextAlign.Center)
    }
}

// Status koneksi dan sinkron di rail: titik hijau/abu, jumlah perubahan yang
// belum terkirim, dan ikon berputar saat sinkron berjalan. Ketuk untuk sinkron.
@Composable
private fun SyncButton(operations: OperationsState, onSync: () -> Unit) {
    val spin = rememberInfiniteTransition(label = "sync-spin")
    val angle by spin.animateFloat(0f, 360f, infiniteRepeatable(tween(900, easing = LinearEasing), RepeatMode.Restart), label = "sync-angle")
    Column(
        modifier = Modifier
            .width(72.dp)
            .clip(RoundedCornerShape(Pos.Radius))
            .clickable(enabled = !operations.syncing, onClick = onSync)
            .padding(vertical = Pos.Space2),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Box {
            Icon(
                Icons.Outlined.Sync,
                contentDescription = "Sync now",
                tint = if (operations.unsynced > 0) Pos.Warning else Pos.Muted,
                modifier = Modifier.size(22.dp).then(if (operations.syncing) Modifier.rotate(angle) else Modifier),
            )
            StatusDot(if (operations.isOnline) Pos.Success else Pos.Subtle, modifier = Modifier.align(Alignment.TopEnd))
        }
        AnimatedContent(targetState = when {
            operations.syncing -> "Syncing"
            operations.unsynced > 0 -> "${operations.unsynced} to sync"
            operations.isOnline -> "Online"
            else -> "Offline"
        }, label = "sync-label") { label ->
            Text(label, style = PosType.Micro.copy(fontWeight = PosType.Body.fontWeight), color = if (operations.unsynced > 0) Pos.Warning else Pos.Muted, textAlign = TextAlign.Center)
        }
    }
}

// Jam tablet yang salah membuat waktu pesanan, tanggal shift, dan jadwal
// sinkron salah. Diperiksa dari jam server tiap kali tablet online.
@Composable
private fun ClockWarning(drift: String) {
    val context = LocalContext.current
    InfoBanner(
        "This tablet's clock is $drift. Order times, shift dates, and sync times will be wrong.",
        tone = Tone.Warning,
        modifier = Modifier.padding(start = Pos.Space4, end = Pos.Space4, top = Pos.Space4),
    ) {
        PosButton("Fix clock", onClick = {
            runCatching { context.startActivity(Intent(Settings.ACTION_DATE_SETTINGS)) }
        }, size = ButtonSize.Small)
    }
}
