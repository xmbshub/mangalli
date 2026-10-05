package id.mangalli.pos.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Print
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import id.mangalli.pos.offline.LocalOrderEntity
import id.mangalli.pos.offline.LocalShiftEntity

// Riwayat dan audit di tablet: transaksi 7 hari terakhir dan shift. Data yang
// sama terkirim ke dashboard saat sinkron.
@Composable
fun HistoryScreen(state: PosUiState, actions: PosActions) {
    var tab by rememberSaveable { mutableStateOf("sales") }
    var filter by rememberSaveable { mutableStateOf("all") }
    var query by rememberSaveable { mutableStateOf("") }
    var selectedOrder by rememberSaveable { mutableStateOf<String?>(null) }
    var selectedShift by rememberSaveable { mutableStateOf<String?>(null) }

    val sales = state.history.filter { order ->
        when (filter) {
            "paid" -> order.paymentStatus == "completed" && order.status != "cancelled"
            "unpaid" -> order.paymentStatus != "completed" && order.status != "cancelled"
            "cancelled" -> order.status == "cancelled"
            else -> true
        } && (query.isBlank() || order.code().contains(query.trim(), true) || order.contextLabel().contains(query.trim(), true))
    }
    val paidTotal = state.history.filter { it.paymentStatus == "completed" && it.status != "cancelled" }.sumOf { it.total }

    Column(modifier = Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(Pos.Space4)) {
        ScreenHeader("History", "Last 7 days on this tablet · ${formatPrice(paidTotal)} paid") {
            Segmented(listOf("sales" to "Sales", "shifts" to "Shifts"), tab, { tab = it }, modifier = Modifier.width(240.dp), height = Pos.Control)
        }
        Row(modifier = Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(Pos.Space4)) {
            PosCard(modifier = Modifier.width(420.dp).fillMaxHeight(), padding = PaddingValues(0.dp)) {
                if (tab == "sales") {
                    Column(modifier = Modifier.padding(Pos.Space4), verticalArrangement = Arrangement.spacedBy(Pos.Space3)) {
                        SearchField(query, { query = it }, "Search code, table, or name", modifier = Modifier.fillMaxWidth())
                        Segmented(listOf("all" to "All", "paid" to "Paid", "unpaid" to "Unpaid", "cancelled" to "Cancelled"), filter, { filter = it }, modifier = Modifier.fillMaxWidth())
                    }
                    HorizontalLine()
                    if (sales.isEmpty()) {
                        EmptyState("No transactions", modifier = Modifier.fillMaxSize())
                    } else {
                        LazyColumn(modifier = Modifier.fillMaxSize()) {
                            items(sales, key = { it.localUuid }) { order ->
                                HistoryRow(
                                    title = "${order.code()} · ${order.contextLabel()}",
                                    subtitle = "${dateTimeLabel(order.createdAtMillis)} · ${paymentMethodLabel(order.paymentMethod.takeIf { order.paymentStatus == "completed" })}",
                                    amount = formatPrice(order.total),
                                    pill = when {
                                        order.status == "cancelled" -> "Cancelled" to Tone.Danger
                                        order.paymentStatus == "completed" -> "Paid" to Tone.Success
                                        else -> "Unpaid" to Tone.Warning
                                    },
                                    selected = order.localUuid == selectedOrder,
                                    onClick = { selectedOrder = order.localUuid },
                                )
                            }
                        }
                    }
                } else {
                    if (state.shifts.isEmpty()) {
                        EmptyState("No shifts yet", modifier = Modifier.fillMaxSize())
                    } else {
                        LazyColumn(modifier = Modifier.fillMaxSize()) {
                            items(state.shifts, key = { it.localUuid }) { shift ->
                                val difference = shift.actualCash?.let { it - expectedCashOf(shift, state) }
                                HistoryRow(
                                    title = "${shift.businessDate} · ${shift.closedByName ?: shift.openedByName ?: "Cashier"}",
                                    subtitle = "${clockLabel(shift.openedAtMillis)} – ${if (shift.closedAtMillis == null) "now" else clockLabel(shift.closedAtMillis)}",
                                    amount = difference?.let { signedPrice(it) } ?: "",
                                    pill = if (shift.status == "open") "Open" to Tone.Success else "Closed" to Tone.Neutral,
                                    selected = shift.localUuid == selectedShift,
                                    onClick = { selectedShift = shift.localUuid },
                                )
                            }
                        }
                    }
                }
            }
            PosCard(modifier = Modifier.weight(1f).fillMaxHeight(), padding = PaddingValues(0.dp)) {
                if (tab == "sales") {
                    val order = state.history.firstOrNull { it.localUuid == selectedOrder }
                    if (order == null) EmptyState("Select a transaction", modifier = Modifier.fillMaxSize())
                    else OrderHistoryDetail(order, actions)
                } else {
                    val shift = state.shifts.firstOrNull { it.localUuid == selectedShift }
                    if (shift == null) EmptyState("Select a shift", modifier = Modifier.fillMaxSize())
                    else ShiftDetail(shift, state, actions)
                }
            }
        }
    }
}

@Composable
private fun HistoryRow(title: String, subtitle: String, amount: String, pill: Pair<String, Tone>, selected: Boolean, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(if (selected) Pos.PrimarySoft else androidx.compose.ui.graphics.Color.Transparent)
            .clickable(onClick = onClick)
            .padding(horizontal = Pos.Space4, vertical = Pos.Space3),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Pos.Space3),
    ) {
        StatusDot(if (selected) Pos.Primary else androidx.compose.ui.graphics.Color.Transparent)
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = PosType.Label, color = Pos.Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(subtitle, style = PosType.Caption, color = Pos.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            if (amount.isNotBlank()) Text(amount, style = PosType.Label, color = Pos.Ink)
            Pill(pill.first, pill.second)
        }
    }
    HorizontalLine(modifier = Modifier.padding(start = Pos.Space4))
}

@Composable
private fun OrderHistoryDetail(order: LocalOrderEntity, actions: PosActions) {
    Column(modifier = Modifier.fillMaxSize()) {
        Row(modifier = Modifier.padding(Pos.Space5), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Pos.Space3)) {
            Column(modifier = Modifier.weight(1f)) {
                Text("${order.code()} · ${order.contextLabel()}", style = PosType.Title, color = Pos.Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    "${if (order.source == "menu") "Digital menu" else "Cashier"} · ${dateTimeLabel(order.createdAtMillis)} · ${if (order.dirty) "waiting to sync" else "synced"}",
                    style = PosType.Caption,
                    color = if (order.dirty) Pos.Warning else Pos.Muted,
                )
            }
            Pill(statusLabel(order.status), statusTone(order.status))
            if (order.paymentStatus == "completed" && order.status != "cancelled") {
                PosButton("Reprint receipt", onClick = { actions.printOrderReceipt(order.localUuid) }, variant = ButtonVariant.Secondary, icon = Icons.Outlined.Print)
            }
        }
        HorizontalLine()
        OrderSummary(order)
    }
}

@Composable
private fun ShiftDetail(shift: LocalShiftEntity, state: PosUiState, actions: PosActions) {
    val orders = state.history.filter { it.shiftLocalUuid == shift.localUuid }
    val summary = shiftSummaryOf(shift, orders)
    Column(modifier = Modifier.fillMaxSize()) {
        Row(modifier = Modifier.padding(Pos.Space5), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Pos.Space3)) {
            Column(modifier = Modifier.weight(1f)) {
                Text("Shift ${shift.businessDate}", style = PosType.Title, color = Pos.Ink)
                Text(
                    "Opened by ${shift.openedByName ?: "—"} · ${dateTimeLabel(shift.openedAtMillis)}" +
                        (shift.closedByName?.let { " · Closed by $it" } ?: "") + (shift.approvedByName?.let { ", approved by $it" } ?: ""),
                    style = PosType.Caption, color = Pos.Muted,
                )
            }
            Pill(if (shift.status == "open") "Open" else "Closed", if (shift.status == "open") Tone.Success else Tone.Neutral)
            if (shift.status == "closed") PosButton("Print report", onClick = { actions.printShiftReport(shift.localUuid) }, variant = ButtonVariant.Secondary, icon = Icons.Outlined.Print)
        }
        HorizontalLine()
        Column(modifier = Modifier.verticalScroll(rememberScrollState()).padding(Pos.Space6), verticalArrangement = Arrangement.spacedBy(Pos.Space3)) {
            KeyValue("Opening cash", formatPrice(shift.openingCash))
            KeyValue("Cash sales", formatPrice(summary.cashSales))
            KeyValue("Non-cash sales", formatPrice(summary.nonCashSales))
            KeyValue("Paid orders", summary.orderCount.toString())
            KeyValue("Cancelled orders", summary.cancelledCount.toString())
            HorizontalLine()
            KeyValue("Expected cash", formatPrice(summary.expectedCash), emphasize = true)
            shift.actualCash?.let { counted ->
                KeyValue("Counted cash", formatPrice(counted))
                val difference = counted - summary.expectedCash
                KeyValue("Difference", signedPrice(difference), valueColor = if (difference == 0.0) Pos.Success else if (difference < 0) Pos.Danger else Pos.Warning)
            }
            if (shift.closedAtMillis != null) KeyValue("Closed", dateTimeLabel(shift.closedAtMillis))
        }
    }
}

private fun expectedCashOf(shift: LocalShiftEntity, state: PosUiState): Double =
    shiftSummaryOf(shift, state.history.filter { it.shiftLocalUuid == shift.localUuid }).expectedCash

fun signedPrice(value: Double): String = when {
    value > 0 -> "+${formatPrice(value)}"
    value < 0 -> "−${formatPrice(-value)}"
    else -> formatPrice(0.0)
}
