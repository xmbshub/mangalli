package id.mangalli.pos.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Print
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import id.mangalli.pos.offline.OfflineOrders

@Composable
fun PaymentDialog(state: PosUiState, actions: PosActions) {
    val pricing = state.pricing
    val total = pricing.total
    val draft = state.draft
    val context = listOfNotNull(
        if (draft.mode == ORDER_MODE_DINEIN) "Dine in · Table ${draft.tableNumber.ifBlank { "—" }}" else "Takeaway",
        draft.customerName.takeIf { it.isNotBlank() },
    ).joinToString(" · ")

    PosDialog(onDismiss = { if (!state.isBusy) actions.openPayment(false) }, width = 980.dp, fixedHeight = 680.dp, dismissOnOutside = !state.isBusy) {
        DialogHeader("Charge ${formatPrice(total)}", context, onClose = { actions.openPayment(false) })
        Row(modifier = Modifier.weight(1f)) {
            Column(
                modifier = Modifier.width(340.dp).fillMaxHeight().background(Pos.SurfaceMuted).padding(Pos.Space5),
                verticalArrangement = Arrangement.spacedBy(Pos.Space3),
            ) {
                SectionLabel(itemCount(state.cart.sumOf { it.quantity }))
                LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Pos.Space2)) {
                    items(state.cart, key = { it.cartLineId }) { item ->
                        Row {
                            Text("${item.quantity}×", style = PosType.BodySmall, color = Pos.Muted, modifier = Modifier.width(32.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Text(item.name, style = PosType.BodySmall, color = Pos.Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                item.modifierSummary?.takeIf { it.isNotBlank() }?.let { Text(it, style = PosType.Caption, color = Pos.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                            }
                            Text(formatPrice(item.price * item.quantity), style = PosType.BodySmall, color = Pos.Ink)
                        }
                    }
                }
                HorizontalLine()
                KeyValue("Subtotal", formatPrice(pricing.subtotal))
                if (pricing.discount > 0) KeyValue(pricing.discountLabel ?: "Discount", "−${formatPrice(pricing.discount)}", valueColor = Pos.Success)
                if (state.outlet.taxRate > 0) KeyValue(OfflineOrders.taxLabel(), formatPrice(pricing.tax))
                KeyValue("Total", formatPrice(total), emphasize = true)
            }
            Box(modifier = Modifier.width(1.dp).fillMaxHeight().background(Pos.Line))
            PaymentPanel(
                total = total,
                busy = state.isBusy,
                confirmLabel = "Charge",
                onConfirm = actions::charge,
                modifier = Modifier.weight(1f).fillMaxHeight().padding(Pos.Space5),
                qris = state.outlet.qrisFor(total),
                onPrintQris = if (state.outlet.qrisReady) ({ done -> actions.printQris(total, draft.customerName.ifBlank { "New order" }, context, done) }) else null,
            )
        }
    }
}

// Panel metode bayar. Tunai: papan angka + pecahan cepat; kosong berarti
// uang pas. Non-tunai: petunjuk singkat dan referensi opsional.
@Composable
fun PaymentPanel(total: Double, busy: Boolean, confirmLabel: String, onConfirm: (PaymentInput) -> Unit, modifier: Modifier = Modifier, qris: QrisDisplay? = null, onPrintQris: ((onResult: (String?) -> Unit) -> Unit)? = null) {
    var method by remember { mutableStateOf(PAYMENT_CASH) }
    var digits by remember { mutableStateOf("") }
    var reference by remember { mutableStateOf("") }
    // Hasil cetak QRIS di panel ini (toast tertutup dialog): null = belum, "" = berhasil.
    var qrisResult by remember { mutableStateOf<String?>(null) }
    var qrisLarge by remember { mutableStateOf(false) }
    val tendered = if (digits.isBlank()) total else parseAmount(digits)
    val change = tendered - total
    val valid = when (method) {
        PAYMENT_CASH -> tendered >= total
        PAYMENT_OTHER -> reference.isNotBlank()
        else -> true
    }

    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(Pos.Space4)) {
        Segmented(
            options = paymentMethods.map { it to paymentMethodLabel(it) },
            selected = method,
            onSelect = { method = it },
            modifier = Modifier.fillMaxWidth(),
            height = Pos.Control,
        )
        if (method == PAYMENT_CASH) {
            Row(verticalAlignment = Alignment.Bottom) {
                Column(modifier = Modifier.weight(1f)) {
                    SectionLabel("Cash received")
                    AnimatedContent(targetState = tendered, transitionSpec = { EnterTransition.None togetherWith ExitTransition.None }, label = "tendered") { value ->
                        Text(formatPrice(value), style = PosType.Amount, color = if (digits.isBlank()) Pos.Subtle else Pos.Ink)
                    }
                }
                Column(horizontalAlignment = Alignment.End) {
                    SectionLabel("Change")
                    Text(
                        if (change >= 0) formatPrice(change) else "−${formatPrice(-change)}",
                        style = PosType.AmountSmall,
                        color = if (change >= 0) Pos.Success else Pos.Danger,
                    )
                }
            }
            Row(modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(Pos.Space2)) {
                suggestedCashAmounts(total).forEachIndexed { index, amount ->
                    ChoiceChip(
                        if (index == 0 && amount == total) "Exact" else formatPrice(amount),
                        selected = digits.isNotBlank() && parseAmount(digits) == amount || (digits.isBlank() && index == 0 && amount == total),
                        onClick = { digits = if (amount == total) "" else Math.round(amount).toString() },
                    )
                }
            }
            Numpad(onKey = { digits = appendDigits(digits, it) }, onBackspace = { digits = digits.dropLast(1) }, modifier = Modifier.weight(1f))
        } else {
            val hint = when (method) {
                PAYMENT_QRIS -> "Show the store QRIS. Confirm after the customer's payment of ${formatPrice(total)} succeeds. Upload the QRIS in the dashboard to show it here with the amount."
                PAYMENT_EDC -> "Run ${formatPrice(total)} on the card machine, then confirm."
                PAYMENT_TRANSFER -> "Check that ${formatPrice(total)} has arrived, then confirm."
                else -> "Describe how the customer paid."
            }
            if (method == PAYMENT_QRIS && qris != null) {
                QrisCard(qris, total, onEnlarge = { qrisLarge = true }, onPrint = onPrintQris?.let { print -> { qrisResult = null; print { qrisResult = it ?: "" } } }, busy = busy)
                qrisResult?.let { result ->
                    Text(
                        if (result.isEmpty()) "QRIS printed. Confirm after the customer's payment of ${formatPrice(total)} succeeds." else result,
                        style = PosType.Caption,
                        color = if (result.isEmpty()) Pos.Success else Pos.Danger,
                    )
                }
                if (qrisLarge) QrisFullScreen(qris, total, onClose = { qrisLarge = false })
            } else {
                InfoBanner(hint, tone = Tone.Info)
            }
            PosTextField(
                value = reference,
                onValueChange = { reference = it.take(120) },
                label = if (method == PAYMENT_OTHER) "Payment note" else "Reference (optional)",
                placeholder = if (method == PAYMENT_OTHER) "e.g. voucher, e-wallet" else "Approval code or last 4 digits",
                capitalization = KeyboardCapitalization.Sentences,
            )
            Spacer(Modifier.weight(1f))
        }
        PosButton(
            "$confirmLabel ${formatPrice(total)}",
            onClick = { onConfirm(PaymentInput(method, tendered, reference)) },
            size = ButtonSize.Large,
            enabled = valid,
            loading = busy,
            haptic = true,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
fun PaymentSuccessDialog(result: SaleResult, actions: PosActions) {
    val scale = remember { Animatable(0.4f) }
    LaunchedEffect(result.code) { scale.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessLow)) }
    PosDialog(onDismiss = actions::closeSaleResult, width = 460.dp) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(Pos.Space6),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Pos.Space2),
        ) {
            Box(modifier = Modifier.scale(scale.value).size(72.dp).clip(CircleShape).background(Pos.SuccessSoft), contentAlignment = Alignment.Center) {
                Box(modifier = Modifier.size(48.dp).clip(CircleShape).background(Pos.Success), contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.Check, contentDescription = null, tint = Color.White, modifier = Modifier.size(28.dp))
                }
            }
            Spacer(Modifier.height(Pos.Space2))
            Text("Payment complete", style = PosType.Title, color = Pos.Ink)
            Text("${result.code} · ${result.methodLabel}", style = PosType.BodySmall, color = Pos.Muted)
            Text(formatPrice(result.total), style = PosType.Amount, color = Pos.Ink)
            if (result.change != null && result.change > 0) {
                Box(modifier = Modifier.clip(CircleShape).background(Pos.SuccessSoft).padding(horizontal = Pos.Space4, vertical = Pos.Space2)) {
                    Text("Change ${formatPrice(result.change)}", style = PosType.Label, color = Pos.Success, textAlign = TextAlign.Center)
                }
            }
        }
        Row(modifier = Modifier.fillMaxWidth().padding(start = Pos.Space6, end = Pos.Space6, bottom = Pos.Space6), horizontalArrangement = Arrangement.spacedBy(Pos.Space3)) {
            PosButton("Print receipt", onClick = actions::printLastReceipt, variant = ButtonVariant.Secondary, icon = Icons.Outlined.Print, size = ButtonSize.Large, modifier = Modifier.weight(1f))
            PosButton("New order", onClick = actions::closeSaleResult, size = ButtonSize.Large, modifier = Modifier.weight(1f))
        }
    }
}
