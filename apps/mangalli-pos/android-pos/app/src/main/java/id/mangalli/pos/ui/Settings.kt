package id.mangalli.pos.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Bluetooth
import androidx.compose.material.icons.outlined.LocalPrintshop
import androidx.compose.material.icons.outlined.ReceiptLong
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import id.mangalli.pos.printer.BluetoothEscPosPrinter
import id.mangalli.pos.printer.BluetoothPrinterStore
import id.mangalli.pos.printer.EscPos58mm
import id.mangalli.pos.printer.PairedPrinter
import id.mangalli.pos.printer.PrinterRole
import id.mangalli.pos.security.OfflineStaff

@Composable
fun SettingsScreen(state: PosUiState, actions: PosActions) {
    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(Pos.Space4)) {
        ScreenHeader("Settings", "${state.outlet.name} · Mangalli POS ${state.appVersion}")
        Row(modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(Pos.Space4)) {
            OutletCard(state, actions, Modifier.weight(1f).fillMaxHeight())
            SyncCard(state, actions, Modifier.weight(1f).fillMaxHeight())
        }
        Row(modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(Pos.Space4)) {
            PrinterCard(Modifier.weight(1f).fillMaxHeight())
            CashiersCard(state, actions, Modifier.weight(1f).fillMaxHeight())
        }
        TabletModeCard(state, actions)
        HelpCard(state, actions)
        Text(
            "Menu, prices, tax and tables come from the dashboard.",
            style = PosType.Caption,
            color = Pos.Muted,
            modifier = Modifier.padding(horizontal = Pos.Space1, vertical = Pos.Space2),
        )
        Text("Mangalli POS ${state.appVersion} · $BRAND_CREDIT · 1garis.id", style = PosType.Caption, color = Pos.Subtle, modifier = Modifier.padding(horizontal = Pos.Space1))
    }
}

@Composable
private fun OutletCard(state: PosUiState, actions: PosActions, modifier: Modifier) {
    var confirm by remember { mutableStateOf(false) }
    val risk = listOfNotNull(
        state.operations.shift?.let { "the open shift" },
        state.operations.unsynced.takeIf { it > 0 }?.let { "$it unsynced change(s)" },
    )
    PosCard(modifier = modifier) {
        CardHeader("Outlet & device", "Main cashier for this outlet.")
        Spacer(Modifier.height(Pos.Space4))
        Column(verticalArrangement = Arrangement.spacedBy(Pos.Space3)) {
            KeyValue("Outlet", state.outlet.name)
            KeyValue("Outlet code", state.outlet.outletKey.ifBlank { "—" })
            KeyValue("Server", state.serverHost)
            KeyValue("Tax", if (state.outlet.taxRate > 0) "${Math.round(state.outlet.taxRate * 1000) / 10.0}%".replace(".0%", "%") else "No tax")
            KeyValue("Tables", if (state.outlet.tables.isEmpty()) "Not set up" else "${state.outlet.tables.size} tables")
            KeyValue("App", state.update?.let { "${state.appVersion} · ${it.versionName} available" } ?: state.appVersion, valueColor = if (state.update != null) Pos.Primary else Pos.Ink)
        }
        Spacer(Modifier.weight(1f))
        Spacer(Modifier.height(Pos.Space4))
        if (!state.canManage) Text("Owner or manager only.", style = PosType.Caption, color = Pos.Muted, modifier = Modifier.padding(bottom = Pos.Space2))
        Row(horizontalArrangement = Arrangement.spacedBy(Pos.Space3)) {
            PosButton(
                if (state.update != null) "Update to ${state.update.versionName}" else "Check for updates",
                onClick = { if (state.update != null) actions.openUpdate() else actions.checkForUpdate() },
                variant = ButtonVariant.Secondary,
                modifier = Modifier.weight(1f),
            )
            PosButton("Disconnect this tablet", onClick = { confirm = true }, variant = ButtonVariant.DangerSoft, enabled = state.canManage, modifier = Modifier.weight(1f))
        }
    }
    if (confirm) {
        ConfirmDialog(
            title = "Disconnect this tablet?",
            body = if (risk.isEmpty()) "Clears this tablet. Your data is safe on the dashboard."
            else "Also deletes ${risk.joinToString(" and ")}. Sync first.",
            confirmLabel = "Disconnect",
            danger = true,
            onConfirm = actions::disconnectDevice,
            onDismiss = { confirm = false },
            cancelLabel = "Cancel",
        )
    }
}

@Composable
private fun SyncCard(state: PosUiState, actions: PosActions, modifier: Modifier) {
    val ops = state.operations
    PosCard(modifier = modifier) {
        CardHeader("Sync", "Saved here first, then sent to the dashboard.")
        Spacer(Modifier.height(Pos.Space4))
        Column(verticalArrangement = Arrangement.spacedBy(Pos.Space3)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Pos.Space2)) {
                Pill(if (ops.isOnline) "Online" else "Offline", if (ops.isOnline) Tone.Success else Tone.Neutral)
                Pill(if (ops.unsynced == 0) "Everything synced" else "${ops.unsynced} waiting", if (ops.unsynced == 0) Tone.Success else Tone.Warning)
            }
            KeyValue("Last sync", dateTimeLabel(ops.lastSync))
            KeyValue("Next scheduled", dateTimeLabel(ops.nextSync))
            KeyValue("Schedule", state.outlet.syncTimes.joinToString(", "))
            ops.lastSyncMessage?.let { Text(it, style = PosType.Caption, color = Pos.Muted, maxLines = 3, overflow = TextOverflow.Ellipsis) }
        }
        Spacer(Modifier.weight(1f))
        Spacer(Modifier.height(Pos.Space4))
        PosButton(if (ops.syncing) "Syncing" else "Sync now", onClick = actions::syncNow, loading = ops.syncing, enabled = ops.isOnline, icon = Icons.Outlined.Sync, modifier = Modifier.fillMaxWidth())
    }
}

@Composable
private fun CashiersCard(state: PosUiState, actions: PosActions, modifier: Modifier) {
    var removing by remember { mutableStateOf<OfflineStaff?>(null) }
    PosCard(modifier = modifier) {
        CardHeader("Cashiers on this tablet", "Can sign in offline.")
        Spacer(Modifier.height(Pos.Space4))
        Column(verticalArrangement = Arrangement.spacedBy(Pos.Space3)) {
            state.knownStaff.forEach { staff ->
                val current = staff.email == state.currentStaff?.email
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Pos.Space3)) {
                    Avatar(staff.name, selected = current)
                    Column(modifier = Modifier.weight(1f)) {
                        Text(staff.name, style = PosType.Label, color = Pos.Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("${roleLabel(staff.role)} · ${staff.email}", style = PosType.Caption, color = Pos.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    if (current) Pill("Signed in", Tone.Success)
                    else if (state.canManage) PosButton("Remove", onClick = { removing = staff }, variant = ButtonVariant.Ghost, size = ButtonSize.Small)
                }
            }
        }
    }
    removing?.let { staff ->
        ConfirmDialog(
            title = "Remove ${staff.name}?",
            body = "${staff.name} can no longer sign in offline on this tablet. Their next sign-in needs internet.",
            confirmLabel = "Remove",
            danger = true,
            onConfirm = { actions.forgetStaff(staff.email) },
            onDismiss = { removing = null },
            cancelLabel = "Cancel",
        )
    }
}

@Composable
private fun PrinterCard(modifier: Modifier) {
    val context = LocalContext.current
    val store = remember(context) { BluetoothPrinterStore(context) }
    val printer = remember(context) { BluetoothEscPosPrinter(context) }
    val main = remember { Handler(Looper.getMainLooper()) }
    var receipt by remember { mutableStateOf(store.name(PrinterRole.RECEIPT) to store.address(PrinterRole.RECEIPT)) }
    var kitchen by remember { mutableStateOf(store.name(PrinterRole.KITCHEN) to store.address(PrinterRole.KITCHEN)) }
    var choosing by remember { mutableStateOf<PrinterRole?>(null) }
    var pendingRole by remember { mutableStateOf<PrinterRole?>(null) }
    var devices by remember { mutableStateOf<List<PairedPrinter>>(emptyList()) }
    var status by remember { mutableStateOf<Pair<String, Tone>?>(null) }
    var testing by remember { mutableStateOf<PrinterRole?>(null) }

    val load: (PrinterRole) -> Unit = { role ->
        runCatching { printer.pairedPrinters() }
            .onSuccess { devices = it; choosing = role }
            .onFailure { status = (it.message ?: "Couldn't read Bluetooth devices.") to Tone.Danger }
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) pendingRole?.let(load) else status = "Allow Nearby devices to connect printers." to Tone.Warning
        pendingRole = null
    }
    fun choose(role: PrinterRole) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            pendingRole = role
            permission.launch(Manifest.permission.BLUETOOTH_CONNECT)
        } else load(role)
    }
    fun test(role: PrinterRole, address: String?) {
        if (address.isNullOrBlank()) return
        testing = role
        Thread {
            val result = runCatching { printer.print(address, EscPos58mm.test(role)) }
            main.post {
                testing = null
                status = result.fold({ "Test page printed." to Tone.Success }, { "Print failed: ${it.message}" to Tone.Danger })
            }
        }.start()
    }

    PosCard(modifier = modifier) {
        CardHeader("Printers", "58 mm Bluetooth, paired in Android.")
        Spacer(Modifier.height(Pos.Space4))
        Column(verticalArrangement = Arrangement.spacedBy(Pos.Space3)) {
            PrinterRow(Icons.Outlined.LocalPrintshop, "Receipts & bills", receipt, testing == PrinterRole.RECEIPT, { test(PrinterRole.RECEIPT, receipt.second) }, { choose(PrinterRole.RECEIPT) })
            PrinterRow(Icons.Outlined.ReceiptLong, "Kitchen tickets", kitchen, testing == PrinterRole.KITCHEN, { test(PrinterRole.KITCHEN, kitchen.second) }, { choose(PrinterRole.KITCHEN) })
            status?.let { (text, tone) -> Text(text, style = PosType.Caption, color = if (tone == Tone.Neutral) Pos.Muted else tone.foreground()) }
        }
        Spacer(Modifier.weight(1f))
        Spacer(Modifier.height(Pos.Space4))
        PosButton("Bluetooth settings", onClick = { context.startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS)) }, variant = ButtonVariant.Secondary, icon = Icons.Outlined.Bluetooth, modifier = Modifier.fillMaxWidth())
    }

    choosing?.let { role ->
        PosDialog(onDismiss = { choosing = null }, width = 560.dp) {
            DialogHeader(if (role == PrinterRole.KITCHEN) "Kitchen printer" else "Receipt printer", "Paired in Bluetooth settings.", onClose = { choosing = null })
            DialogBody(Pos.Space2) {
                if (devices.isEmpty()) {
                    EmptyState("No paired printers. Pair one in Bluetooth settings.")
                } else devices.forEach { device ->
                    PosCard(padding = PaddingValues(Pos.Space4), onClick = {
                        store.save(role, device.address, device.name)
                        if (role == PrinterRole.KITCHEN) kitchen = device.name to device.address else receipt = device.name to device.address
                        status = "${device.name} saved." to Tone.Success
                        choosing = null
                    }) {
                        Text(device.name, style = PosType.Label, color = Pos.Ink)
                        Text(device.address, style = PosType.Caption, color = Pos.Muted)
                    }
                }
            }
        }
    }
}

@Composable
private fun PrinterRow(icon: ImageVector, title: String, device: Pair<String?, String?>, testing: Boolean, onTest: () -> Unit, onChoose: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Pos.Space3)) {
        Icon(icon, contentDescription = null, tint = Pos.Muted, modifier = Modifier.size(20.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = PosType.Label, color = Pos.Ink)
            Text(if (device.second.isNullOrBlank()) "Not set up" else device.first ?: device.second!!, style = PosType.Caption, color = if (device.second.isNullOrBlank()) Pos.Warning else Pos.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (!device.second.isNullOrBlank()) PosButton("Test", onClick = onTest, variant = ButtonVariant.Ghost, size = ButtonSize.Small, loading = testing)
        PosButton(if (device.second.isNullOrBlank()) "Choose" else "Change", onClick = onChoose, variant = ButtonVariant.Secondary, size = ButtonSize.Small)
    }
}

// Laporan masalah manual. Crash dan data yang gagal sinkron dilaporkan otomatis.
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
// Layar selalu menyala + kunci ke Mangalli, supaya salah pencet tidak pindah
// aplikasi dan notifikasi media sosial tidak muncul di tengah transaksi.
@Composable
private fun TabletModeCard(state: PosUiState, actions: PosActions) {
    var unlocking by remember { mutableStateOf(false) }
    val mode = state.tabletMode
    PosCard(modifier = Modifier.fillMaxWidth()) {
        CardHeader("Tablet mode", "For a tablet that stays at the counter.")
        Spacer(Modifier.height(Pos.Space4))
        Row(horizontalArrangement = Arrangement.spacedBy(Pos.Space4)) {
            Row(modifier = Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Pos.Space3)) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("Keep screen on", style = PosType.Label, color = Pos.Ink)
                    Text("Never dims while open. Keep it charging.", style = PosType.Caption, color = Pos.Muted)
                }
                PosButton(if (mode.keepScreenOn) "On" else "Off", onClick = { actions.setKeepScreenOn(!mode.keepScreenOn) },
                    variant = if (mode.keepScreenOn) ButtonVariant.Primary else ButtonVariant.Secondary)
            }
            Row(modifier = Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Pos.Space3)) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(if (mode.locked) "Locked to Mangalli" else "Lock to Mangalli", style = PosType.Label, color = Pos.Ink)
                    Text(
                        if (mode.locked) "Unlock to pair a printer or update."
                        else "Blocks Home, recents and notifications.",
                        style = PosType.Caption, color = Pos.Muted,
                    )
                }
                if (mode.locked) PosButton("Unlock", onClick = { if (state.canManage) actions.unlockTablet("") else unlocking = true }, variant = ButtonVariant.Secondary)
                else PosButton("Lock", onClick = actions::lockTablet)
            }
        }
        Spacer(Modifier.height(Pos.Space4))
        // Chime pesanan menu digital (permintaan owner 4 Okt 2026); menyalakannya
        // langsung memutar contoh bunyi supaya kasir tahu volumenya cukup.
        Row(horizontalArrangement = Arrangement.spacedBy(Pos.Space4)) {
            Row(modifier = Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Pos.Space3)) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("Order sound", style = PosType.Label, color = Pos.Ink)
                    Text("Chimes for new digital menu orders.", style = PosType.Caption, color = Pos.Muted)
                }
                PosButton(if (mode.orderSound) "On" else "Off", onClick = { actions.setOrderSound(!mode.orderSound) },
                    variant = if (mode.orderSound) ButtonVariant.Primary else ButtonVariant.Secondary)
            }
            Spacer(Modifier.weight(1f))
        }
    }
    if (unlocking) {
        var error by remember { mutableStateOf<String?>(null) }
        PinDialog("Unlock this tablet", "A manager or owner types their approval PIN.", onDismiss = { unlocking = false },
            onComplete = { pin -> actions.unlockTablet(pin) { failed -> if (failed == null) unlocking = false else error = failed } },
            error = error, busy = state.isBusy, onEdit = { error = null })
    }
}

@Composable
private fun HelpCard(state: PosUiState, actions: PosActions) {
    var open by remember { mutableStateOf(false) }
    PosCard(modifier = Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Pos.Space4)) {
            Column(modifier = Modifier.weight(1f)) {
                CardHeader("Problems & help", "Crashes are reported automatically.")
            }
            PosButton("Report a problem", onClick = { open = true }, variant = ButtonVariant.Secondary)
        }
    }
    if (open) {
        var category by remember { mutableStateOf("payment") }
        var message by remember { mutableStateOf("") }
        PosDialog(onDismiss = { open = false }, width = 560.dp) {
            DialogHeader("Report a problem", "Sent with this tablet's details.", onClose = { open = false })
            DialogBody {
                androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(Pos.Space2), verticalArrangement = Arrangement.spacedBy(Pos.Space2)) {
                    listOf("payment" to "Payment", "printer" to "Printer", "sync" to "Sync", "menu" to "Menu", "error" to "Something broke", "other" to "Other").forEach { (key, label) ->
                        ChoiceChip(label, selected = category == key, onClick = { category = key })
                    }
                }
                PosTextField(message, { message = it.take(2000) }, "What happened?", placeholder = "e.g. QRIS payment for table 7 didn't show as paid", singleLine = false, minLines = 4, capitalization = androidx.compose.ui.text.input.KeyboardCapitalization.Sentences)
                if (!state.operations.isOnline) Text("Offline. Connect to send.", style = PosType.Caption, color = Pos.Warning)
            }
            DialogFooter {
                PosButton("Send report", onClick = { actions.reportProblem(category, message); open = false }, enabled = message.trim().length >= 5 && state.operations.isOnline)
            }
        }
    }
}
