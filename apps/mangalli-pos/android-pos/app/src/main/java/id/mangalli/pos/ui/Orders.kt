package id.mangalli.pos.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Print
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import id.mangalli.pos.offline.LocalOrderEntity
import id.mangalli.pos.offline.OfflineOrders
import kotlinx.coroutines.delay

private data class OrderColumn(val title: String, val statuses: Set<String>, val accent: Color, val empty: String)

private val orderColumns = listOf(
    OrderColumn("Awaiting payment", setOf("pending_payment"), Pos.Warning, "Digital menu orders appear here until paid."),
    OrderColumn("Preparing", setOf("new", "accepted", "preparing"), Pos.Info, "Paid orders and saved bills go to the kitchen."),
    OrderColumn("Ready", setOf("ready"), Pos.Success, "Orders ready to serve or pick up."),
)

@Composable
fun OrdersScreen(state: PosUiState, actions: PosActions) {
    var selectedId by remember { mutableStateOf<String?>(null) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(30_000)
            now = System.currentTimeMillis()
        }
    }
    val active = state.activeOrders
    Column(modifier = Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(Pos.Space4)) {
        ScreenHeader(
            "Orders",
            "${active.size} active · ${if (state.operations.isOnline) "digital menu checked every minute" else "offline, digital menu orders arrive when back online"}",
        ) {
            PosButton("Refresh", onClick = actions::refreshOrders, variant = ButtonVariant.Secondary, icon = Icons.Outlined.Refresh)
        }
        Row(modifier = Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(Pos.Space4)) {
            orderColumns.forEach { column ->
                val orders = active.filter { it.status in column.statuses }.sortedBy { it.createdAtMillis }
                PosCard(modifier = Modifier.weight(1f).fillMaxHeight(), padding = PaddingValues(0.dp)) {
                    Box(modifier = Modifier.fillMaxWidth().height(3.dp).background(column.accent))
                    Row(modifier = Modifier.padding(horizontal = Pos.Space4, vertical = Pos.Space3), verticalAlignment = Alignment.CenterVertically) {
                        Text(column.title, style = PosType.Heading, color = Pos.Ink, modifier = Modifier.weight(1f))
                        Pill(orders.size.toString(), if (orders.isEmpty()) Tone.Neutral else Tone.Primary)
                    }
                    HorizontalLine()
                    if (orders.isEmpty()) {
                        EmptyState(column.empty, modifier = Modifier.fillMaxSize())
                    } else {
                        LazyColumn(contentPadding = PaddingValues(Pos.Space3), verticalArrangement = Arrangement.spacedBy(Pos.Space2)) {
                            items(orders, key = { it.localUuid }) { order ->
                                OrderCard(order, now, onClick = { selectedId = order.localUuid }, modifier = Modifier.animateItem())
                            }
                        }
                    }
                }
            }
        }
    }
    val selected = state.orders.firstOrNull { it.localUuid == selectedId }
    if (selected != null) {
        OrderDetailDialog(selected, state, actions, onDismiss = { selectedId = null })
    }
}

@Composable
private fun OrderCard(order: LocalOrderEntity, now: Long, onClick: () -> Unit, modifier: Modifier) {
    val late = now - order.createdAtMillis > 15 * 60_000 && order.status in setOf("new", "accepted", "preparing")
    PosCard(onClick = onClick, padding = PaddingValues(Pos.Space3), modifier = modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Pos.Space2)) {
                Text(order.code(), style = PosType.Label, color = Pos.Ink, modifier = Modifier.weight(1f), maxLines = 1)
                Text(elapsedLabel(order.createdAtMillis, now), style = PosType.Caption, color = if (late) Pos.Danger else Pos.Muted)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Pill(if (order.source == "menu") "Digital menu" else "Cashier", if (order.source == "menu") Tone.Info else Tone.Neutral)
                Text(order.contextLabel(), style = PosType.Caption, color = Pos.Text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text(order.itemSummary(), style = PosType.Caption, color = Pos.Muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(formatPrice(order.total), style = PosType.Label, color = Pos.Ink, modifier = Modifier.weight(1f))
                Pill(if (order.paymentStatus == "completed") "Paid" else "Unpaid", if (order.paymentStatus == "completed") Tone.Success else Tone.Warning)
            }
        }
    }
}

private enum class DetailStep { Summary, Payment, Cancel }

@Composable
fun OrderDetailDialog(order: LocalOrderEntity, state: PosUiState, actions: PosActions, onDismiss: () -> Unit) {
    var step by remember(order.localUuid) { mutableStateOf(DetailStep.Summary) }
    var reason by remember(order.localUuid) { mutableStateOf("") }
    var pin by remember(order.localUuid) { mutableStateOf("") }
    var cancelError by remember(order.localUuid) { mutableStateOf<String?>(null) }
    val paid = order.paymentStatus == "completed"
    val finished = order.status in setOf("completed", "cancelled")
    // Refund atau pesanan yang sudah diproses dapur butuh persetujuan manager/owner.
    val cancelNeedsApproval = (paid || (order.status != "new" && order.status != "pending_payment")) && !state.canManage
    PosDialog(onDismiss = onDismiss, width = 720.dp, fixedHeight = if (step == DetailStep.Payment) 680.dp else null) {
        DialogHeader(
            title = "${order.code()} · ${order.contextLabel()}",
            subtitle = "${if (order.source == "menu") "Digital menu" else "Cashier"} · ${dateTimeLabel(order.createdAtMillis)}",
            onClose = onDismiss,
            leading = { Pill(statusLabel(order.status), statusTone(order.status)) },
        )
        AnimatedContent(targetState = step, transitionSpec = { fadeIn(tween(120)) togetherWith ExitTransition.None }, label = "order-step", modifier = Modifier.weight(1f, fill = false)) { current ->
            when (current) {
                DetailStep.Summary -> OrderSummary(order)
                DetailStep.Payment -> PaymentPanel(
                    total = order.total,
                    busy = state.isBusy,
                    confirmLabel = if (order.status == "pending_payment") "Receive" else "Pay & close",
                    onConfirm = { input -> actions.settleOrder(order.localUuid, input); onDismiss() },
                    modifier = Modifier.fillMaxWidth().fillMaxHeight().padding(Pos.Space6),
                    qris = state.outlet.qrisFor(order.total),
                    onPrintQris = if (state.outlet.qrisReady) ({ done -> actions.printQris(order.total, order.code(), order.contextLabel(), done) }) else null,
                )
                DetailStep.Cancel -> CancelStep(order, cancelNeedsApproval, reason, { reason = it; cancelError = null }, pin, { pin = it; cancelError = null }, cancelError)
            }
        }
        if (step == DetailStep.Cancel) {
            DialogFooter(hint = cancelError, hintTone = Tone.Danger) {
                PosButton("Back", onClick = { step = DetailStep.Summary }, variant = ButtonVariant.Secondary)
                PosButton(
                    if (paid) "Refund & cancel" else "Cancel order",
                    onClick = { actions.updateOrderStatus(order.localUuid, "cancelled", pin, reason) { failed -> if (failed == null) onDismiss() else cancelError = failed } },
                    variant = ButtonVariant.Danger,
                    enabled = reason.isNotBlank() && (!cancelNeedsApproval || pin.length == 6),
                    loading = state.isBusy,
                    haptic = true,
                )
            }
        }
        if (step == DetailStep.Summary) {
            DialogFooter(hint = if (!order.dirty) "Synced to the dashboard" else "Saved on this tablet · syncs automatically") {
                if (!finished) PosButton("Cancel order", onClick = { step = DetailStep.Cancel }, variant = ButtonVariant.DangerSoft)
                if (paid) PosButton("Receipt", onClick = { actions.printOrderReceipt(order.localUuid) }, variant = ButtonVariant.Secondary, icon = Icons.Outlined.Print)
                if (order.source == "pos" && !paid && !finished) {
                    PosButton("Edit in menu", onClick = { actions.openBill(order.localUuid); onDismiss() }, variant = ButtonVariant.Secondary)
                }
                when {
                    order.status == "pending_payment" -> PosButton("Receive payment", onClick = { step = DetailStep.Payment })
                    order.status == "new" -> PosButton("Accept", onClick = { actions.updateOrderStatus(order.localUuid, "accepted", "", ""); onDismiss() })
                    order.status in setOf("accepted", "preparing") -> PosButton("Mark ready", onClick = { actions.updateOrderStatus(order.localUuid, "ready", "", ""); onDismiss() })
                    order.status == "ready" && !paid -> PosButton("Take payment", onClick = { step = DetailStep.Payment })
                    order.status == "ready" -> PosButton("Complete", onClick = { actions.updateOrderStatus(order.localUuid, "completed", "", ""); onDismiss() })
                }
            }
        }
    }
}

@Composable
fun OrderSummary(order: LocalOrderEntity) {
    val items = OfflineOrders.itemsFromJson(order.itemsJson)
    Column(modifier = Modifier.verticalScroll(rememberScrollState()).padding(Pos.Space6), verticalArrangement = Arrangement.spacedBy(Pos.Space3)) {
        items.forEach { item ->
            Row {
                Text("${item.quantity}×", style = PosType.Body, color = Pos.Muted, modifier = Modifier.width(36.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(item.name, style = PosType.Label, color = Pos.Ink)
                    item.modifierSummary?.takeIf { it.isNotBlank() }?.let { Text(it, style = PosType.Caption, color = Pos.Muted) }
                    displayNote(item.notes)?.let { Text("Note: $it", style = PosType.Caption, color = Pos.Warning) }
                }
                Text(formatPrice(item.unitPrice * item.quantity), style = PosType.Body, color = Pos.Ink)
            }
        }
        HorizontalLine()
        KeyValue("Subtotal", formatPrice(order.subtotal))
        if (order.discount > 0) KeyValue(id.mangalli.pos.offline.DiscountSpec.fromJson(order.discountJson)?.label ?: "Discount", "−${formatPrice(order.discount)}", valueColor = Pos.Success)
        if (order.tax > 0) KeyValue("Tax", formatPrice(order.tax))
        KeyValue("Total", formatPrice(order.total), emphasize = true)
        KeyValue("Payment", if (order.paymentStatus == "completed") "${paymentMethodLabel(order.paymentMethod)} · paid ${clockLabel(order.paidAtMillis)}" else "Unpaid", valueColor = if (order.paymentStatus == "completed") Pos.Success else Pos.Warning)
        order.paymentNotes?.takeIf { it.isNotBlank() }?.let { KeyValue("Payment note", it) }
        order.cancelReason?.takeIf { order.status == "cancelled" }?.let { KeyValue("Cancel reason", it, valueColor = Pos.Danger) }
    }
}

@Composable
private fun CancelStep(order: LocalOrderEntity, needsApproval: Boolean, reason: String, onReason: (String) -> Unit, pin: String, onPin: (String) -> Unit, error: String?) {
    val paid = order.paymentStatus == "completed"
    Column(modifier = Modifier.verticalScroll(rememberScrollState()).padding(Pos.Space6), verticalArrangement = Arrangement.spacedBy(Pos.Space4)) {
        InfoBanner(
            if (paid) "This order is paid (${formatPrice(order.total)}, ${paymentMethodLabel(order.paymentMethod)}). Cancelling it records a refund: hand the money back to the customer."
            else "Removed from the kitchen.",
            tone = Tone.Danger,
        )
        ApprovalFields(
            reason = reason, onReason = onReason, password = pin, onPassword = onPin, needsApproval = needsApproval,
            quickReasons = if (paid) listOf("Customer complaint", "Wrong order", "Double payment") else listOf("Customer left", "Wrong order", "Out of stock"),
            error = error,
        )
    }
}
