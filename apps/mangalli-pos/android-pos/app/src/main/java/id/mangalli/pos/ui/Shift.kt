package id.mangalli.pos.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Print
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

@Composable
fun ShiftScreen(state: PosUiState, actions: PosActions) {
    val shift = state.operations.shift
    var lastOpenId by remember { mutableStateOf(shift?.localUuid) }
    var closedId by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(shift?.localUuid) {
        if (lastOpenId != null && shift == null) closedId = lastOpenId
        lastOpenId = shift?.localUuid
    }

    Column(modifier = Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(Pos.Space4)) {
        ScreenHeader(
            "Shift",
            if (shift == null) "Closed · open a shift before taking payments" else "Open since ${clockLabel(shift.openedAtMillis)} · ${shift.openedByName ?: "Cashier"}",
        )
        if (shift == null) OpenShiftView(state, actions, Modifier.weight(1f)) else OpenedShiftView(state, actions, Modifier.weight(1f))
    }

    closedId?.let { id ->
        val closed = state.shifts.firstOrNull { it.localUuid == id }
        if (closed != null) {
            val summary = shiftSummaryOf(closed, state.history.filter { it.shiftLocalUuid == id })
            PosDialog(onDismiss = { closedId = null }, width = 520.dp) {
                DialogHeader("Shift closed", "${closed.businessDate} · ${clockLabel(closed.openedAtMillis)} – ${clockLabel(closed.closedAtMillis)}", onClose = { closedId = null })
                DialogBody(Pos.Space3) {
                    KeyValue("Paid orders", summary.orderCount.toString())
                    KeyValue("Cash sales", formatPrice(summary.cashSales))
                    KeyValue("Non-cash sales", formatPrice(summary.nonCashSales))
                    KeyValue("Expected cash", formatPrice(summary.expectedCash))
                    closed.actualCash?.let { counted ->
                        KeyValue("Counted cash", formatPrice(counted), emphasize = true)
                        val difference = counted - summary.expectedCash
                        KeyValue("Difference", signedPrice(difference), valueColor = if (difference == 0.0) Pos.Success else Pos.Danger)
                    }
                }
                DialogFooter(hint = if (state.operations.unsynced > 0) "The report is sent to the dashboard at the next sync." else "The report is on the dashboard.") {
                    PosButton("Print report", onClick = { actions.printShiftReport(id) }, variant = ButtonVariant.Secondary, icon = Icons.Outlined.Print)
                    PosButton("Done", onClick = { closedId = null })
                }
            }
        }
    }
}

@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun OpenShiftView(state: PosUiState, actions: PosActions, modifier: Modifier) {
    var digits by rememberSaveable { mutableStateOf("") }
    var confirmOpen by remember { mutableStateOf(false) }
    val amount = parseAmount(digits)
    val last = state.shifts.firstOrNull { it.status == "closed" }
    if (confirmOpen) {
        val carried = state.openBills
        ConfirmDialog(
            title = "Open the shift?",
            body = "Starting cash ${formatPrice(amount)}, opened by ${state.currentStaff?.name ?: "you"}." +
                if (carried.isNotEmpty()) " ${carried.size} open bill(s) (${formatPrice(carried.sumOf { it.total })}) from the last shift move to this one." else "",
            confirmLabel = "Open shift",
            onConfirm = { actions.openShift(amount); digits = "" },
            onDismiss = { confirmOpen = false },
            cancelLabel = "Recount",
        )
    }
    Row(modifier = modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Pos.Space4)) {
        PosCard(modifier = Modifier.weight(1f).fillMaxHeight()) {
            CardHeader("Open a shift", "Count the cash in the drawer before the first sale.")
            Spacer(Modifier.height(Pos.Space5))
            Row(modifier = Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(Pos.Space6)) {
                Column(modifier = Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(Pos.Space4)) {
                    SectionLabel("Starting cash")
                    AnimatedContent(targetState = amount, label = "opening-cash") { value -> Text(formatPrice(value), style = PosType.Amount, color = Pos.Ink) }
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(Pos.Space2), verticalArrangement = Arrangement.spacedBy(Pos.Space2)) {
                        listOf(0.0, 100_000.0, 200_000.0, 500_000.0).forEach { preset ->
                            ChoiceChip(if (preset == 0.0) "No cash" else formatPrice(preset), selected = amount == preset && (digits.isNotBlank() || preset == 0.0), onClick = { digits = if (preset == 0.0) "" else Math.round(preset).toString() })
                        }
                    }
                    Text("Works offline. Syncs to the dashboard later.", style = PosType.Caption, color = Pos.Muted)
                    Spacer(Modifier.weight(1f))
                    PosButton("Open shift", onClick = { confirmOpen = true }, size = ButtonSize.Large, loading = state.isBusy, haptic = true, modifier = Modifier.fillMaxWidth())
                }
                Numpad(onKey = { digits = appendDigits(digits, it) }, onBackspace = { digits = digits.dropLast(1) }, modifier = Modifier.weight(1f).fillMaxHeight())
            }
        }
        PosCard(modifier = Modifier.width(360.dp).fillMaxHeight()) {
            CardHeader("Last shift", last?.let { "${it.businessDate} · closed by ${it.closedByName ?: it.openedByName ?: "Cashier"}" })
            Spacer(Modifier.height(Pos.Space4))
            if (last == null) {
                EmptyState("No shifts yet", modifier = Modifier.fillMaxSize())
            } else {
                val summary = shiftSummaryOf(last, state.history.filter { it.shiftLocalUuid == last.localUuid })
                Column(verticalArrangement = Arrangement.spacedBy(Pos.Space3)) {
                    KeyValue("Hours", "${clockLabel(last.openedAtMillis)} – ${clockLabel(last.closedAtMillis)}")
                    KeyValue("Paid orders", summary.orderCount.toString())
                    KeyValue("Sales", formatPrice(summary.cashSales + summary.nonCashSales))
                    last.actualCash?.let { KeyValue("Cash difference", signedPrice(it - summary.expectedCash), valueColor = if (it == summary.expectedCash) Pos.Success else Pos.Danger) }
                }
                Spacer(Modifier.weight(1f))
                PosButton("Print report", onClick = { actions.printShiftReport(last.localUuid) }, variant = ButtonVariant.Secondary, icon = Icons.Outlined.Print, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

@Composable
private fun OpenedShiftView(state: PosUiState, actions: PosActions, modifier: Modifier) {
    val shift = state.operations.shift ?: return
    val summary = state.operations.summary ?: shiftSummaryOf(shift, emptyList())
    var digits by rememberSaveable(shift.localUuid) { mutableStateOf("") }
    var confirm by remember { mutableStateOf(false) }
    var cashDialog by remember { mutableStateOf(false) }
    val counted = parseAmount(digits)
    val difference = counted - summary.expectedCash
    val movements = id.mangalli.pos.offline.OfflineOrders.cashMovementsFromJson(shift.cashMovementsJson)

    Row(modifier = modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Pos.Space4)) {
        Column(modifier = Modifier.weight(1.2f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(Pos.Space4)) {
            Row(modifier = Modifier.height(128.dp), horizontalArrangement = Arrangement.spacedBy(Pos.Space4)) {
                StatCard("Starting cash", formatPrice(shift.openingCash), "Counted at ${clockLabel(shift.openedAtMillis)}", Modifier.weight(1f).fillMaxHeight())
                StatCard("Cash sales", formatPrice(summary.cashSales), "In the drawer", Modifier.weight(1f).fillMaxHeight())
                StatCard("Non-cash sales", formatPrice(summary.nonCashSales), "QRIS, card, transfer", Modifier.weight(1f).fillMaxHeight())
            }
            Row(modifier = Modifier.height(128.dp), horizontalArrangement = Arrangement.spacedBy(Pos.Space4)) {
                StatCard("Paid orders", summary.orderCount.toString(), "${summary.cancelledCount} cancelled", Modifier.weight(1f).fillMaxHeight())
                StatCard("Open bills", summary.openBills.toString(), if (summary.openBills > 0) "${formatPrice(summary.openBillTotal)} unpaid" else "All settled", Modifier.weight(1f).fillMaxHeight(), tone = if (summary.openBills > 0) Tone.Warning else null)
                StatCard("Expected cash", formatPrice(summary.expectedCash), if (movements.isEmpty()) "Starting + cash sales" else "Includes cash in/out", Modifier.weight(1f).fillMaxHeight(), tone = Tone.Primary)
            }
            // Transaksi shift ini: kasir memeriksa sebelum menghitung laci.
            val shiftOrders = state.history.filter { it.shiftLocalUuid == shift.localUuid }
            PosCard(modifier = Modifier.weight(1f).fillMaxWidth(), padding = PaddingValues(0.dp)) {
                Column(modifier = Modifier.padding(Pos.Space5)) {
                    CardHeader(
                        "This shift",
                        "${shiftOrders.size} transactions" + if (movements.isEmpty()) "" else " · cash out ${formatPrice(summary.cashOut)}" + if (summary.cashIn > 0) ", cash in ${formatPrice(summary.cashIn)}" else "",
                    ) { PosButton("Cash in/out", onClick = { cashDialog = true }, variant = ButtonVariant.Secondary, size = ButtonSize.Small) }
                }
                HorizontalLine()
                if (shiftOrders.isEmpty() && movements.isEmpty()) {
                    EmptyState("No transactions yet", modifier = Modifier.fillMaxSize())
                } else {
                    LazyColumn(modifier = Modifier.fillMaxSize()) {
                        items(movements.reversed(), key = { it.id }) { movement ->
                            Row(modifier = Modifier.fillMaxWidth().padding(horizontal = Pos.Space5, vertical = Pos.Space3), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Pos.Space3)) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(movement.reason, style = PosType.Label, color = Pos.Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(
                                        "${clockLabel(movement.atMillis)} · ${movement.byName ?: "Cashier"}" + (movement.approvedByName?.let { " · approved by $it" } ?: ""),
                                        style = PosType.Caption, color = Pos.Muted,
                                    )
                                }
                                Text(signedPrice(movement.signed), style = PosType.Label, color = if (movement.kind == "out") Pos.Danger else Pos.Success)
                                Pill(if (movement.kind == "out") "Cash out" else "Cash in", if (movement.kind == "out") Tone.Warning else Tone.Success)
                            }
                            HorizontalLine(modifier = Modifier.padding(start = Pos.Space5))
                        }
                        items(shiftOrders, key = { it.localUuid }) { order ->
                            Row(modifier = Modifier.fillMaxWidth().padding(horizontal = Pos.Space5, vertical = Pos.Space3), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Pos.Space3)) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text("${order.code()} · ${order.contextLabel()}", style = PosType.Label, color = Pos.Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text("${clockLabel(order.createdAtMillis)} · ${if (order.paymentStatus == "completed") paymentMethodLabel(order.paymentMethod) else "Unpaid"}", style = PosType.Caption, color = Pos.Muted)
                                }
                                Text(formatPrice(order.total), style = PosType.Label, color = if (order.status == "cancelled") Pos.Subtle else Pos.Ink)
                                Pill(statusLabel(order.status), statusTone(order.status))
                            }
                            HorizontalLine(modifier = Modifier.padding(start = Pos.Space5))
                        }
                    }
                }
            }
        }
        PosCard(modifier = Modifier.weight(1f).fillMaxHeight()) {
            CardHeader("Close shift", "Count the drawer, then close.")
            Spacer(Modifier.height(Pos.Space4))
            Row(verticalAlignment = Alignment.Bottom) {
                Column(modifier = Modifier.weight(1f)) {
                    SectionLabel("Counted cash")
                    Text(formatPrice(counted), style = PosType.Amount, color = if (digits.isBlank()) Pos.Subtle else Pos.Ink)
                }
                if (digits.isNotBlank()) {
                    Column(horizontalAlignment = Alignment.End) {
                        SectionLabel("Difference")
                        Text(signedPrice(difference), style = PosType.AmountSmall, color = if (difference == 0.0) Pos.Success else Pos.Danger)
                    }
                }
            }
            Spacer(Modifier.height(Pos.Space3))
            Numpad(onKey = { digits = appendDigits(digits, it) }, onBackspace = { digits = digits.dropLast(1) }, modifier = Modifier.weight(1f))
            Spacer(Modifier.height(Pos.Space3))
            if (summary.openBills > 0) {
                InfoBanner("${summary.openBills} open bill(s), ${formatPrice(summary.openBillTotal)}, will move to the next shift.", tone = Tone.Warning) {
                    PosButton("View", onClick = { actions.navigate(Screen.Orders) }, size = ButtonSize.Small, variant = ButtonVariant.Secondary)
                }
                Spacer(Modifier.height(Pos.Space3))
            }
            PosButton(
                "Close shift",
                onClick = { confirm = true },
                size = ButtonSize.Large,
                enabled = digits.isNotBlank(),
                loading = state.isBusy,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
    if (cashDialog) CashDialog(state, summary.expectedCash, onSave = { kind, amount, reason, pin, onResult -> actions.recordCash(kind, amount, reason, pin) { failed -> onResult(failed); if (failed == null) cashDialog = false } }, onDismiss = { cashDialog = false })
    if (confirm) CloseShiftDialog(state, counted, summary.expectedCash, summary.openBills, onClose = { note, password, onResult -> actions.closeShift(counted, note, password) { failed -> onResult(failed); if (failed == null) confirm = false } }, onDismiss = { confirm = false })
}

// Konfirmasi tutup shift: selisih kas wajib diberi catatan; kas kurang dan bill
// terbuka yang dibawa ke shift berikutnya butuh PIN manager/owner bila kasir.
@Composable
private fun CloseShiftDialog(state: PosUiState, counted: Double, expected: Double, openBills: Int, onClose: (String, String, (String?) -> Unit) -> Unit, onDismiss: () -> Unit) {
    var note by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val difference = counted - expected
    val balanced = kotlin.math.abs(difference) < 1
    // Kas kurang atau bill yang dibawa: kasir butuh PIN manager/owner.
    val short = difference <= -1
    val needsApproval = (openBills > 0 || short) && !state.canManage
    PosDialog(onDismiss = onDismiss, width = 540.dp) {
        DialogHeader("Close the shift?", "A new shift is needed before the next sale.", onClose = onDismiss)
        DialogBody(Pos.Space3) {
            KeyValue("Expected cash", formatPrice(expected))
            KeyValue("Counted cash", formatPrice(counted), emphasize = true)
            KeyValue("Difference", if (balanced) "Balanced" else signedPrice(difference), valueColor = if (balanced) Pos.Success else Pos.Danger)
            if (openBills > 0) InfoBanner("$openBills open bill(s) move to the next shift.", tone = Tone.Warning)
            if (!balanced || needsApproval) {
                ApprovalFields(
                    reason = note, onReason = { note = it; error = null }, password = password, onPassword = { password = it; error = null }, needsApproval = needsApproval, error = error,
                    quickReasons = if (balanced) emptyList() else listOf("Change given wrong", "Counting error", "Cash out not recorded"),
                    reasonLabel = if (balanced) "Note" else "Why is the cash different?",
                )
            }
        }
        DialogFooter(hint = error, hintTone = Tone.Danger) {
            PosButton("Recount", onClick = onDismiss, variant = ButtonVariant.Secondary)
            PosButton("Close shift", onClick = { onClose(note, password) { failed -> error = failed } }, enabled = (balanced || note.isNotBlank()) && (!needsApproval || password.length == 6), loading = state.isBusy, haptic = true)
        }
    }
}

// Cash out (mis. beli galon, es batu) atau cash in (tambah uang kecil). Kas
// seharusnya ikut berubah, jadi laci tetap seimbang saat tutup shift.
@Composable
private fun CashDialog(state: PosUiState, expected: Double, onSave: (String, Double, String, String, (String?) -> Unit) -> Unit, onDismiss: () -> Unit) {
    var kind by remember { mutableStateOf("out") }
    var digits by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("") }
    var pin by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val amount = parseAmount(digits)
    val needsApproval = kind == "out" && !state.canManage
    val tooMuch = kind == "out" && amount > expected
    PosDialog(onDismiss = onDismiss, width = 560.dp) {
        DialogHeader("Cash in/out", "Drawer money outside a sale.", onClose = onDismiss)
        DialogBody {
            Segmented(listOf("out" to "Cash out", "in" to "Cash in"), selected = kind, onSelect = { kind = it; pin = "" }, modifier = Modifier.fillMaxWidth())
            PosTextField(
                digits, { digits = it.filter(Char::isDigit).take(9) }, if (amount >= 1) "Amount · ${formatPrice(amount)}" else "Amount (Rp)", placeholder = "e.g. 20000",
                keyboardType = androidx.compose.ui.text.input.KeyboardType.Number,
                error = if (tooMuch) "The drawer should only have ${formatPrice(expected)}." else null,
            )
            ApprovalFields(
                reason = reason, onReason = { reason = it; error = null }, password = pin, onPassword = { pin = it; error = null }, needsApproval = needsApproval, error = error,
                quickReasons = if (kind == "out") listOf("Gallon water", "Ice", "Gas", "Supplies", "Parking") else listOf("Add small change", "Owner top-up"),
                reasonLabel = if (kind == "out") "What was it for?" else "Where is it from?",
            )
        }
        DialogFooter(hint = error ?: "Prints on the shift report.", hintTone = if (error != null) Tone.Danger else Tone.Neutral) {
            PosButton("Cancel", onClick = onDismiss, variant = ButtonVariant.Secondary)
            PosButton(
                if (kind == "out") "Record cash out" else "Record cash in",
                onClick = { onSave(kind, amount, reason, pin) { failed -> error = failed } },
                loading = state.isBusy,
                enabled = amount >= 1 && !tooMuch && reason.isNotBlank() && (!needsApproval || pin.length == 6),
                haptic = true,
            )
        }
    }
}

@Composable
private fun StatCard(label: String, value: String, hint: String, modifier: Modifier, tone: Tone? = null) {
    PosCard(modifier = modifier, padding = PaddingValues(Pos.Space5)) {
        Text(label, style = PosType.BodySmall, color = Pos.Muted)
        Spacer(Modifier.height(Pos.Space2))
        Text(value, style = PosType.AmountSmall, color = tone?.foreground() ?: Pos.Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Spacer(Modifier.weight(1f))
        Text(hint, style = PosType.Caption, color = Pos.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
