package id.mangalli.pos.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.ReceiptLong
import androidx.compose.material.icons.outlined.Sell
import androidx.compose.material.icons.outlined.TableRestaurant
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.ThumbUp
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import id.mangalli.pos.offline.CartItemEntity
import id.mangalli.pos.offline.CatalogProductEntity
import id.mangalli.pos.offline.LocalOrderEntity
import id.mangalli.pos.offline.OfflineOrders
import id.mangalli.pos.offline.PromoRules
import java.util.Locale

private const val ALL = "All"
// Filter label dari dashboard (Products > Highlights), di baris yang sama dengan kategori.
private const val BEST_SELLERS = "label:best"
private const val FAVOURITES = "label:favourite"

// Label produk sebagai ikon: bintang = Best seller, jempol = Favourite (Customer favourite di dashboard).
val BestSellerIcon = Icons.Rounded.Star
val FavouriteIcon = Icons.Rounded.ThumbUp

@Composable
fun MenuScreen(state: PosUiState, actions: PosActions) {
    var sheet by remember { mutableStateOf<Pair<CatalogProductEntity, CartItemEntity?>?>(null) }
    val haptics = LocalHapticFeedback.current
    Row(modifier = Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(Pos.Space4)) {
        CatalogPane(
            state = state,
            actions = actions,
            onProduct = { product ->
                if (modifierGroups(product).isEmpty()) {
                    haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                    actions.addProduct(product, emptyList(), 1, "", null)
                } else {
                    sheet = product to null
                }
            },
            modifier = Modifier.weight(1f).fillMaxHeight(),
        )
        OrderPane(
            state = state,
            actions = actions,
            onEditItem = { item -> state.products.firstOrNull { it.id == item.productId }?.let { sheet = it to item } },
            modifier = Modifier.width(408.dp).fillMaxHeight(),
        )
    }
    sheet?.let { (product, editing) ->
        ProductSheet(
            product = product,
            editing = editing,
            // Batas dari stok: sisa + jumlah baris yang sedang diedit (null = tidak dilacak).
            maxQuantity = state.stockLeft[product.id]?.let { left -> (left + (editing?.quantity ?: 0)).coerceAtLeast(0) },
            onDismiss = { sheet = null },
            onSubmit = { options, quantity, notes ->
                actions.addProduct(product, options, quantity, notes, editing?.cartLineId)
                sheet = null
            },
            // Baris yang sudah tersimpan di bill dikurangi lewat Void di panel pesanan.
            onRemove = editing?.takeIf { (state.billQuantities[it.cartLineId] ?: 0) == 0 }?.let { item -> { actions.removeItem(item); sheet = null } },
        )
    }
}

// ---------- Katalog ----------

@Composable
private fun CatalogPane(state: PosUiState, actions: PosActions, onProduct: (CatalogProductEntity) -> Unit, modifier: Modifier) {
    var mode by rememberSaveable { mutableStateOf("menu") }
    var query by rememberSaveable { mutableStateOf("") }
    var category by rememberSaveable { mutableStateOf(ALL) }
    val bestSellers = state.products.count { it.isBestSeller }
    val favourites = state.products.count { it.isFavorite }
    val categories = listOf(ALL) + state.products.mapNotNull { it.categoryName }.distinct()
    val labels = listOfNotNull(BEST_SELLERS.takeIf { bestSellers > 0 }, FAVOURITES.takeIf { favourites > 0 })
    if (category !in categories && category !in labels) category = ALL
    val needle = query.trim().lowercase(Locale.ROOT)
    val visible = state.products.filter { product ->
        when (category) {
            ALL -> true
            BEST_SELLERS -> product.isBestSeller
            FAVOURITES -> product.isFavorite
            else -> product.categoryName == category
        } &&
            (needle.isBlank() || product.name.lowercase(Locale.ROOT).contains(needle) || product.categoryName.orEmpty().lowercase(Locale.ROOT).contains(needle))
    }
    val inCart = state.cart.groupBy { it.productId }.mapValues { (_, lines) -> lines.sumOf { it.quantity } }

    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(Pos.Space3)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Pos.Space3), verticalAlignment = Alignment.CenterVertically) {
            if (mode == "menu") {
                SearchField(query, { query = it }, "Search ${state.products.size} products", modifier = Modifier.weight(1f))
            } else {
                Column(modifier = Modifier.weight(1f)) {
                    Text("Custom amount", style = PosType.Title, color = Pos.Ink)
                    Text("Charge an item that isn't on the menu.", style = PosType.Caption, color = Pos.Muted)
                }
            }
            Segmented(
                options = listOf("menu" to "Products", "keypad" to "Custom amount"),
                selected = mode,
                onSelect = { mode = it },
                modifier = Modifier.width(280.dp),
                height = Pos.Field,
            )
        }
        if (state.operations.shift == null) {
            InfoBanner("The shift is closed. Open a shift to take payments.", tone = Tone.Warning) {
                PosButton("Open shift", onClick = { actions.navigate(Screen.Shift) }, size = ButtonSize.Small)
            }
        }
        AnimatedContent(targetState = mode, transitionSpec = { fadeIn(tween(120)) togetherWith ExitTransition.None }, label = "catalog-mode", modifier = Modifier.weight(1f)) { current ->
            if (current == "keypad") {
                CustomAmountPanel(maximum = state.outlet.customAmountMax, onAdd = actions::addCustomAmount, modifier = Modifier.fillMaxSize())
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(Pos.Space3)) {
                    Row(modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(Pos.Space2)) {
                        ChoiceChip(ALL, selected = category == ALL, onClick = { category = ALL })
                        if (bestSellers > 0) ChoiceChip("Best sellers · $bestSellers", selected = category == BEST_SELLERS, onClick = { category = BEST_SELLERS }, icon = BestSellerIcon, iconTint = Pos.Warning)
                        if (favourites > 0) ChoiceChip("Favourites · $favourites", selected = category == FAVOURITES, onClick = { category = FAVOURITES }, icon = FavouriteIcon, iconTint = Pos.Primary)
                        categories.drop(1).forEach { name -> ChoiceChip(name, selected = name == category, onClick = { category = name }) }
                    }
                    when {
                        state.products.isEmpty() -> EmptyState("No menu on this tablet yet", modifier = Modifier.fillMaxSize()) {
                            PosButton("Sync now", onClick = actions::syncNow, variant = ButtonVariant.Secondary)
                        }
                        visible.isEmpty() -> EmptyState("No products match", modifier = Modifier.fillMaxSize())
                        else -> LazyVerticalGrid(
                            columns = GridCells.Adaptive(minSize = 168.dp),
                            modifier = Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(bottom = Pos.Space4),
                            horizontalArrangement = Arrangement.spacedBy(Pos.Space3),
                            verticalArrangement = Arrangement.spacedBy(Pos.Space3),
                        ) {
                            items(visible, key = { it.id }) { product ->
                                ProductCard(product, inCart[product.id] ?: 0, state.stockLeft[product.id], onClick = { onProduct(product) })
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ProductCard(product: CatalogProductEntity, quantityInCart: Int, stockLeft: Int?, onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    // Habis karena stok (dan belum ada di keranjang) sama dengan ditandai habis di dashboard.
    val soldOut = product.isSoldOut || (stockLeft != null && stockLeft <= 0 && quantityInCart == 0)
    val badgeScale by animateFloatAsState(
        targetValue = if (quantityInCart > 0) 1f else 0f,
        animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium),
        label = "cart-badge",
    )
    Column(
        modifier = Modifier
            .pressable(interaction, !soldOut)
            .clip(RoundedCornerShape(Pos.RadiusCard))
            .background(Pos.Surface)
            .border(if (quantityInCart > 0) 1.5.dp else 1.dp, if (quantityInCart > 0) Pos.Primary else Pos.Line, RoundedCornerShape(Pos.RadiusCard))
            .clickable(interactionSource = interaction, indication = null, enabled = !soldOut, onClick = onClick),
    ) {
        Box(modifier = Modifier.fillMaxWidth().aspectRatio(4f / 3f)) {
            ProductImage(product.name, product.categoryName, product.photoUrl, modifier = Modifier.fillMaxSize())
            if (soldOut) Box(modifier = Modifier.fillMaxSize().background(Color.White.copy(alpha = 0.62f)))
            Row(modifier = Modifier.padding(Pos.Space2), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                if (soldOut) Pill("Sold out", Tone.Danger)
                else if (stockLeft != null && stockLeft <= 5) Pill(if (stockLeft > 0) "$stockLeft left" else "None left", Tone.Warning)
                if (product.isBestSeller) LabelBadge(BestSellerIcon, "Best seller", Pos.Warning)
                if (product.isFavorite) LabelBadge(FavouriteIcon, "Favourite", Pos.Primary)
            }
            if (badgeScale > 0f) {
                Box(
                    modifier = Modifier.align(Alignment.TopEnd).padding(Pos.Space2).scale(badgeScale).size(28.dp).clip(CircleShape).background(Pos.Primary),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(quantityInCart.toString(), style = PosType.Label, color = Color.White)
                }
            }
        }
        Column(modifier = Modifier.padding(horizontal = Pos.Space3, vertical = Pos.Space3), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(product.name, style = PosType.Label, color = if (soldOut) Pos.Muted else Pos.Ink, maxLines = 2, minLines = 2, overflow = TextOverflow.Ellipsis)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(formatPrice(product.price), style = PosType.BodySmall, color = if (soldOut) Pos.Subtle else Pos.Text, modifier = Modifier.weight(1f))
                if (modifierGroups(product).isNotEmpty()) Text("Options", style = PosType.Micro.copy(fontWeight = PosType.Body.fontWeight), color = Pos.Muted)
            }
        }
    }
}

// Lencana label di foto produk: ikon saja, arti dibacakan untuk aksesibilitas.
@Composable
private fun LabelBadge(icon: ImageVector, description: String, tint: Color) {
    Box(
        modifier = Modifier.size(26.dp).clip(CircleShape).background(Pos.Surface).border(1.dp, Pos.Line, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = description, tint = tint, modifier = Modifier.size(15.dp))
    }
}

private val placeholderPalettes = listOf(
    Color(0xFFFFEDD5) to Color(0xFFC2410C),
    Color(0xFFEFF6FF) to Color(0xFF1D4ED8),
    Color(0xFFF4EFE8) to Color(0xFF7A5B3A),
    Color(0xFFECFDF5) to Color(0xFF15803D),
)

@Composable
fun ProductImage(name: String, category: String?, photoUrl: String?, modifier: Modifier = Modifier) {
    val palette = placeholderPalettes[((category ?: name).hashCode() and Int.MAX_VALUE) % placeholderPalettes.size]
    Box(modifier = modifier.background(palette.first), contentAlignment = Alignment.Center) {
        Text(initials(name), style = PosType.Title, color = palette.second)
        if (!photoUrl.isNullOrBlank()) {
            AsyncImage(model = photoUrl, contentDescription = null, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        }
    }
}

@Composable
private fun CustomAmountPanel(maximum: Double, onAdd: (String, Double) -> Unit, modifier: Modifier) {
    var digits by rememberSaveable { mutableStateOf("") }
    var label by rememberSaveable { mutableStateOf("") }
    val amount = parseAmount(digits)
    val tooHigh = amount > maximum
    PosCard(modifier = modifier, padding = PaddingValues(Pos.Space5)) {
        Row(modifier = Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(Pos.Space6)) {
            Column(modifier = Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(Pos.Space4)) {
                PosTextField(
                    value = label,
                    onValueChange = { label = it.take(80) },
                    label = "Description",
                    placeholder = "Custom amount",
                    capitalization = KeyboardCapitalization.Sentences,
                )
                SectionLabel("Amount")
                AnimatedContent(targetState = amount, transitionSpec = { EnterTransition.None togetherWith ExitTransition.None }, label = "custom-amount") { value ->
                    Text(formatPrice(value), style = PosType.Amount, color = if (value > 0) Pos.Ink else Pos.Subtle)
                }
                if (tooHigh) Text("Maximum ${formatPrice(maximum)}.", style = PosType.Caption, color = Pos.Danger)
                Spacer(Modifier.weight(1f))
                PosButton(
                    "Add to order",
                    onClick = {
                        onAdd(label.trim().ifBlank { "Custom amount" }, amount)
                        digits = ""
                        label = ""
                    },
                    size = ButtonSize.Large,
                    enabled = amount > 0 && !tooHigh,
                    haptic = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Numpad(
                onKey = { digits = appendDigits(digits, it) },
                onBackspace = { digits = digits.dropLast(1) },
                modifier = Modifier.weight(1f).fillMaxHeight(),
            )
        }
    }
}

// ---------- Pesanan ----------

@Composable
private fun OrderPane(state: PosUiState, actions: PosActions, onEditItem: (CartItemEntity) -> Unit, modifier: Modifier) {
    var confirmClear by remember { mutableStateOf(false) }
    var showBills by remember { mutableStateOf(false) }
    var showTables by remember { mutableStateOf(false) }
    // Item bill tersimpan yang akan di-void, dengan jumlah awal pilihan.
    var voiding by remember { mutableStateOf<Pair<CartItemEntity, Int>?>(null) }
    // Hapus baris pesanan selalu dikonfirmasi (owner: aksi berbahaya dua langkah).
    var removing by remember { mutableStateOf<CartItemEntity?>(null) }
    val draft = state.draft
    val pricing = state.pricing
    val total = pricing.total
    var discountOpen by remember { mutableStateOf(false) }
    val count = state.cart.sumOf { it.quantity }
    val editingBill = draft.activeBillId != null

    PosCard(modifier = modifier, padding = PaddingValues(0.dp)) {
        Column(modifier = Modifier.padding(Pos.Space4), verticalArrangement = Arrangement.spacedBy(Pos.Space3)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Pos.Space2)) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(draft.activeBillLabel ?: "Current order", style = PosType.Heading, color = Pos.Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        if (editingBill) "Saved bill · ${itemCount(count)}" else if (count == 0) "No items" else itemCount(count),
                        style = PosType.Caption,
                        color = if (editingBill) Pos.PrimaryPressed else Pos.Muted,
                    )
                }
                PosIconButton(Icons.Outlined.ReceiptLong, "Open bills", { showBills = true }, badge = state.openBills.size)
                PosIconButton(Icons.Outlined.DeleteOutline, if (editingBill) "Close bill" else "Clear order", { confirmClear = true }, enabled = state.cart.isNotEmpty() || editingBill, tint = Pos.Danger)
            }
            Segmented(
                options = listOf(ORDER_MODE_TAKEAWAY to "Takeaway", ORDER_MODE_DINEIN to "Dine in"),
                selected = draft.mode,
                onSelect = actions::setOrderMode,
                modifier = Modifier.fillMaxWidth(),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(Pos.Space2)) {
                AnimatedVisibility(visible = draft.mode == ORDER_MODE_DINEIN, enter = fadeIn(), exit = fadeOut()) {
                    val hasTable = draft.tableNumber.isNotBlank()
                    PosButton(
                        if (hasTable) "Table ${draft.tableNumber}" else "Choose table",
                        onClick = { showTables = true },
                        variant = if (hasTable) ButtonVariant.Secondary else ButtonVariant.Secondary,
                        icon = Icons.Outlined.TableRestaurant,
                        modifier = Modifier.width(150.dp).height(Pos.Field),
                    )
                }
                CompactField(
                    value = draft.customerName,
                    onValueChange = actions::setCustomerName,
                    placeholder = if (draft.mode == ORDER_MODE_TAKEAWAY) "Customer name" else "Customer name (optional)",
                    modifier = Modifier.weight(1f),
                )
            }
        }
        HorizontalLine()
        Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
            if (state.cart.isEmpty()) {
                EmptyState("No items yet", modifier = Modifier.fillMaxSize())
            } else {
                LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = Pos.Space2)) {
                    items(state.cart, key = { it.cartLineId }) { item ->
                        val saved = state.billQuantities[item.cartLineId] ?: 0
                        OrderLine(
                            item = item,
                            onMinus = { if (item.quantity - 1 < saved) voiding = item to 1 else if (item.quantity == 1) removing = item else actions.changeQuantity(item, -1) },
                            // Hapus baris: item baru dikonfirmasi dulu; yang sudah di bill lewat Void semua sekaligus.
                            onRemove = { if (saved > 0) voiding = item to saved else removing = item },
                            onPlus = { actions.changeQuantity(item, 1) },
                            onEdit = if (item.isCustomAmount()) null else ({ onEditItem(item) }),
                            modifier = Modifier.animateItem(),
                        )
                    }
                }
            }
        }
        HorizontalLine()
        Column(modifier = Modifier.background(Pos.SurfaceMuted).padding(Pos.Space4), verticalArrangement = Arrangement.spacedBy(Pos.Space2)) {
            KeyValue("Subtotal", formatPrice(pricing.subtotal))
            DiscountRow(state, onOpen = { discountOpen = true }, onRemove = { actions.applyPromo(null) })
            if (state.outlet.taxRate > 0) KeyValue(OfflineOrders.taxLabel(), formatPrice(pricing.tax))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Total", style = PosType.Label, color = Pos.Ink, modifier = Modifier.weight(1f))
                AnimatedContent(targetState = total, transitionSpec = { (slideInVertically { -it / 2 } + fadeIn()) togetherWith (slideOutVertically { it / 2 } + fadeOut()) }, label = "order-total") { value ->
                    Text(formatPrice(value), style = PosType.AmountSmall, color = Pos.Ink)
                }
            }
            Spacer(Modifier.height(Pos.Space1))
            Row(horizontalArrangement = Arrangement.spacedBy(Pos.Space2)) {
                PosButton(
                    if (editingBill) "Update bill" else "Save bill",
                    onClick = { if (editingBill) actions.updateBillAndPrintNewItems() else actions.saveBill() },
                    variant = ButtonVariant.Secondary,
                    size = ButtonSize.Large,
                    enabled = state.cart.isNotEmpty() && !state.isBusy,
                    modifier = Modifier.weight(1f),
                )
                PosButton(
                    if (count > 0) "Charge ${formatPrice(total)}" else "Charge",
                    onClick = { actions.openPayment(true) },
                    size = ButtonSize.Large,
                    enabled = state.cart.isNotEmpty() && !state.isBusy,
                    haptic = true,
                    modifier = Modifier.weight(1.5f),
                )
            }
        }
    }

    removing?.let { item ->
        ConfirmDialog(
            title = "Remove ${item.name}?",
            body = if (item.quantity > 1) "All ${item.quantity} come off the current order." else "It comes off the current order.",
            confirmLabel = "Remove",
            danger = true,
            onConfirm = { actions.removeItem(item) },
            onDismiss = { removing = null },
            cancelLabel = "Keep",
        )
    }
    if (confirmClear) {
        ConfirmDialog(
            title = if (editingBill) "Close this bill?" else "Clear this order?",
            body = if (editingBill) "Unsaved changes are discarded." else "All items are removed from the current order.",
            confirmLabel = if (editingBill) "Close bill" else "Clear order",
            danger = !editingBill,
            onConfirm = actions::clearOrder,
            onDismiss = { confirmClear = false },
        )
    }
    if (showBills) OpenBillsDialog(state.openBills, draft.activeBillId, onOpen = { actions.openBill(it); showBills = false }, onDismiss = { showBills = false })
    if (showTables) TablePicker(state, onPick = { actions.setTable(it); showTables = false }, onDismiss = { showTables = false })
    if (discountOpen) DiscountDialog(state, actions, onDismiss = { discountOpen = false })
    voiding?.let { (item, initial) ->
        val saved = state.billQuantities[item.cartLineId] ?: item.quantity
        // Baris terakhir di bill tidak bisa di-void habis; batalkan pesanan dari Orders.
        val maximum = if (state.billQuantities.size <= 1) saved - 1 else saved
        VoidDialog(item, saved, maximum, initial.coerceIn(1, maximum.coerceAtLeast(1)), state.canManage, state.isBusy,
            onVoid = { count, reason, pin, onResult -> actions.voidItem(item, saved - count, reason, pin) { failed -> onResult(failed); if (failed == null) voiding = null } },
            onDismiss = { voiding = null })
    }
}

// Void item yang sudah tersimpan di bill: pilih jumlahnya sekali, satu alasan
// dan satu PIN (bukan per cup).
@Composable
private fun VoidDialog(item: CartItemEntity, saved: Int, maximum: Int, initial: Int, canManage: Boolean, busy: Boolean, onVoid: (Int, String, String, (String?) -> Unit) -> Unit, onDismiss: () -> Unit) {
    var count by remember { mutableStateOf(initial) }
    var reason by remember { mutableStateOf("") }
    var pin by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    PosDialog(onDismiss = onDismiss, width = 520.dp) {
        DialogHeader("Void ${item.name}", "$saved on the bill, already sent to the kitchen.", onClose = onDismiss)
        DialogBody {
            if (maximum < 1) {
                InfoBanner("Only item on the bill. Cancel the order instead.", tone = Tone.Warning)
            } else {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Pos.Space3)) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("How many to void", style = PosType.Label, color = Pos.Ink)
                        Text("${formatPrice(item.price * count)} off the bill", style = PosType.Caption, color = Pos.Muted)
                    }
                    if (maximum > 1) ChoiceChip("All $maximum", selected = count == maximum, onClick = { count = maximum })
                    QuantityStepper(count, onMinus = { count = (count - 1).coerceAtLeast(1) }, onPlus = { count = (count + 1).coerceAtMost(maximum) })
                }
                ApprovalFields(
                    reason = reason, onReason = { reason = it; error = null }, password = pin, onPassword = { pin = it; error = null },
                    needsApproval = !canManage, quickReasons = listOf("Customer changed mind", "Wrong item", "Out of stock", "Made wrong"), error = error,
                )
            }
        }
        DialogFooter(hint = error, hintTone = Tone.Danger) {
            PosButton("Keep", onClick = onDismiss, variant = ButtonVariant.Secondary)
            PosButton(
                "Void $count×",
                onClick = { onVoid(count, reason, pin) { failed -> error = failed } },
                variant = ButtonVariant.Danger,
                enabled = maximum >= 1 && reason.isNotBlank() && (canManage || pin.length == 6),
                loading = busy,
                haptic = true,
            )
        }
    }
}

@Composable
private fun CompactField(value: String, onValueChange: (String) -> Unit, placeholder: String, modifier: Modifier) {
    androidx.compose.material3.OutlinedTextField(
        value = value,
        onValueChange = { onValueChange(it.take(80)) },
        modifier = modifier.height(Pos.Field),
        placeholder = { Text(placeholder, style = PosType.Body, color = Pos.Subtle, maxLines = 1) },
        textStyle = PosType.Body.copy(color = Pos.Ink),
        singleLine = true,
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Done),
        shape = RoundedCornerShape(Pos.Radius),
        colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
            focusedBorderColor = Pos.Primary,
            unfocusedBorderColor = Pos.Line,
            cursorColor = Pos.Primary,
            focusedContainerColor = Pos.Surface,
            unfocusedContainerColor = Pos.Surface,
        ),
    )
}

@Composable
private fun OrderLine(item: CartItemEntity, onMinus: () -> Unit, onPlus: () -> Unit, onRemove: () -> Unit, onEdit: (() -> Unit)?, modifier: Modifier) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .then(if (onEdit != null) Modifier.clickable(onClickLabel = "Edit ${item.name}", onClick = onEdit) else Modifier)
            .padding(horizontal = Pos.Space4, vertical = Pos.Space3),
        verticalArrangement = Arrangement.spacedBy(Pos.Space2),
    ) {
        Row(verticalAlignment = Alignment.Top) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(item.name, style = PosType.Label, color = Pos.Ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                item.modifierSummary?.takeIf { it.isNotBlank() }?.let { Text(it.replace(", ", " · "), style = PosType.Caption, color = Pos.Muted, maxLines = 2, overflow = TextOverflow.Ellipsis) }
                displayNote(item.notes)?.let { Text("Note: $it", style = PosType.Caption, color = Pos.Warning, maxLines = 2, overflow = TextOverflow.Ellipsis) }
            }
            Text(formatPrice(item.price * item.quantity), style = PosType.Label, color = Pos.Ink)
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            QuantityStepper(item.quantity, onMinus, onPlus, compact = true)
            Spacer(Modifier.width(Pos.Space4))
            PosIconButton(Icons.Outlined.DeleteOutline, "Remove ${item.name}", onRemove, outlined = false, tint = Pos.Muted)
            Spacer(Modifier.weight(1f))
            if (onEdit != null) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Icon(Icons.Outlined.Edit, contentDescription = null, tint = Pos.Subtle, modifier = Modifier.size(14.dp))
                    Text("Edit", style = PosType.Caption, color = Pos.Muted)
                }
            } else {
                Text("${formatPrice(item.price)} each", style = PosType.Caption, color = Pos.Muted)
            }
        }
    }
}

@Composable
private fun OpenBillsDialog(bills: List<LocalOrderEntity>, activeBillId: String?, onOpen: (String) -> Unit, onDismiss: () -> Unit) {
    var query by remember { mutableStateOf("") }
    val filtered = bills.filter { query.isBlank() || it.contextLabel().contains(query.trim(), ignoreCase = true) || it.code().contains(query.trim(), ignoreCase = true) }
    PosDialog(onDismiss = onDismiss, width = 600.dp, fixedHeight = 640.dp) {
        DialogHeader("Open bills", if (bills.isEmpty()) "No unpaid bills" else "${bills.size} unpaid · ${formatPrice(bills.sumOf { it.total })}", onClose = onDismiss)
        Column(modifier = Modifier.weight(1f).padding(horizontal = Pos.Space6, vertical = Pos.Space4), verticalArrangement = Arrangement.spacedBy(Pos.Space3)) {
            if (bills.isNotEmpty()) SearchField(query, { query = it }, "Search table, name, or code", modifier = Modifier.fillMaxWidth())
            if (filtered.isEmpty()) {
                EmptyState(if (bills.isEmpty()) "No open bills" else "No bills match", modifier = Modifier.fillMaxSize())
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(Pos.Space2)) {
                    items(filtered, key = { it.localUuid }) { bill ->
                        PosCard(onClick = { onOpen(bill.localUuid) }, selected = bill.localUuid == activeBillId, padding = PaddingValues(Pos.Space4)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Pos.Space3)) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(bill.contextLabel(), style = PosType.Label, color = Pos.Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text("${bill.code()} · ${itemCount(bill.itemCount())} · ${elapsedLabel(bill.createdAtMillis)}", style = PosType.Caption, color = Pos.Muted)
                                }
                                Text(formatPrice(bill.total), style = PosType.Label, color = Pos.Ink)
                                if (bill.localUuid == activeBillId) Pill("Open", Tone.Primary, Icons.Outlined.Check)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TablePicker(state: PosUiState, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    var digits by remember { mutableStateOf(state.draft.tableNumber) }
    val tables = state.outlet.tables.filter { it.number != null }
    // Papan angka hanya menerima meja yang ada di dashboard.
    val problem = when {
        digits.isBlank() -> null
        tables.isEmpty() -> "No tables in the dashboard yet. Add them under Tables & QR, then tap Sync now."
        tables.none { it.number.toString() == digits } -> "Table $digits isn't in the dashboard."
        else -> null
    }
    val busyTables = state.openBills.filter { it.orderMode == ORDER_MODE_DINEIN }.mapNotNull { it.tableNumber }.toSet()
    PosDialog(onDismiss = onDismiss, width = if (tables.isEmpty()) 420.dp else 760.dp, fixedHeight = 560.dp) {
        DialogHeader("Choose table", if (tables.isEmpty()) "No tables synced from the dashboard yet." else "Open bills are marked.", onClose = onDismiss)
        Row(modifier = Modifier.weight(1f).padding(Pos.Space6), horizontalArrangement = Arrangement.spacedBy(Pos.Space6)) {
            if (tables.isNotEmpty()) {
                LazyVerticalGrid(columns = GridCells.Adaptive(96.dp), modifier = Modifier.weight(1.4f), horizontalArrangement = Arrangement.spacedBy(Pos.Space2), verticalArrangement = Arrangement.spacedBy(Pos.Space2)) {
                    // Meja dikelompokkan per area seperti di dashboard.
                    tables.groupBy { it.area.ifBlank { "Tables" } }.forEach { (area, areaTables) ->
                    item(key = "area:$area", span = { GridItemSpan(maxLineSpan) }) { SectionLabel(area, modifier = Modifier.padding(top = Pos.Space2)) }
                    items(areaTables, key = { it.code }) { table ->
                        val number = table.number!!
                        val selected = digits == number.toString()
                        PosCard(onClick = { onPick(number.toString()) }, selected = selected, padding = PaddingValues(Pos.Space2), modifier = Modifier.height(72.dp)) {
                            Column(modifier = Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                                Text(number.toString(), style = PosType.Heading, color = Pos.Ink)
                                Text(if (number in busyTables) "Open bill" else table.label, style = PosType.Micro.copy(fontWeight = PosType.Body.fontWeight), color = if (number in busyTables) Pos.Warning else Pos.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                    }
                }
            }
            Column(modifier = Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(Pos.Space3)) {
                Text(if (digits.isBlank()) "Table —" else "Table $digits", style = PosType.AmountSmall, color = if (digits.isBlank()) Pos.Subtle else if (problem != null) Pos.Danger else Pos.Ink)
                problem?.let { Text(it, style = PosType.Caption, color = Pos.Danger) }
                Numpad(onKey = { digits = appendDigits(digits, it, 4) }, onBackspace = { digits = digits.dropLast(1) }, modifier = Modifier.weight(1f))
                PosButton("Use table", onClick = { onPick(digits) }, enabled = digits.isNotBlank() && problem == null, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

// ---------- Pilihan produk ----------

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ProductSheet(
    product: CatalogProductEntity,
    editing: CartItemEntity?,
    maxQuantity: Int?,
    onDismiss: () -> Unit,
    onSubmit: (List<ModifierOption>, Int, String) -> Unit,
    onRemove: (() -> Unit)?,
) {
    val groups = remember(product.id) { modifierGroups(product) }
    var selected by remember(product.id, editing?.cartLineId) {
        mutableStateOf(editing?.modifierOptionIdSet() ?: groups.filter { it.isRequired && it.effectiveMaxSelect() == 1 }.mapNotNull { it.options.firstOrNull()?.id }.toSet())
    }
    val cap = (maxQuantity ?: 99).coerceAtMost(99)
    var quantity by remember(product.id, editing?.cartLineId) { mutableStateOf((editing?.quantity ?: 1).coerceIn(1, cap.coerceAtLeast(1))) }
    var notes by remember(product.id, editing?.cartLineId) { mutableStateOf(displayNote(editing?.notes).orEmpty()) }
    val options = groups.flatMap { it.options }.filter { it.id in selected }
    val unit = product.price + options.sumOf { it.priceDelta }
    val missing = groups.firstOrNull { group -> group.options.count { it.id in selected } < group.minSelect }

    PosDialog(onDismiss = onDismiss, width = 840.dp) {
        DialogHeader(
            title = product.name,
            subtitle = listOfNotNull(product.description, formatPrice(product.price)).joinToString(" · "),
            onClose = onDismiss,
            leading = {
                ProductImage(product.name, product.categoryName, product.photoUrl, modifier = Modifier.size(64.dp).clip(RoundedCornerShape(Pos.Radius)))
            },
        )
        Column(
            modifier = Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(horizontal = Pos.Space6, vertical = Pos.Space5),
            verticalArrangement = Arrangement.spacedBy(Pos.Space5),
        ) {
            groups.forEach { group ->
                val count = group.options.count { it.id in selected }
                Column(verticalArrangement = Arrangement.spacedBy(Pos.Space3)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Pos.Space2)) {
                        Text(group.name, style = PosType.Heading, color = Pos.Ink)
                        Pill(group.selectionHint(), if (count < group.minSelect) Tone.Warning else Tone.Neutral)
                    }
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(Pos.Space2), verticalArrangement = Arrangement.spacedBy(Pos.Space2)) {
                        group.options.forEach { option ->
                            OptionTile(option, selected = option.id in selected) { selected = toggleModifierOption(selected, group, option) }
                        }
                    }
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("Quantity", style = PosType.Heading, color = Pos.Ink)
                    if (maxQuantity != null) Text(if (cap > 0) "$cap left in stock" else "Out of stock", style = PosType.Caption, color = if (cap <= 5) Pos.Warning else Pos.Muted)
                }
                QuantityStepper(quantity, onMinus = { quantity = (quantity - 1).coerceAtLeast(1) }, onPlus = { quantity = (quantity + 1).coerceAtMost(cap) })
            }
            PosTextField(
                value = notes,
                onValueChange = { notes = it.take(255) },
                label = "Note for the kitchen",
                placeholder = "e.g. less spicy, no ice",
                capitalization = KeyboardCapitalization.Sentences,
            )
        }
        DialogFooter(hint = missing?.let { "Choose ${it.name.lowercase(Locale.ROOT)} to continue." }, hintTone = Tone.Warning) {
            // Dua langkah: ketukan pertama menyiapkan, ketukan kedua menghapus.
            if (onRemove != null) {
                var armed by remember { mutableStateOf(false) }
                PosButton(if (armed) "Tap again to remove" else "Remove", onClick = { if (armed) onRemove() else armed = true }, variant = if (armed) ButtonVariant.Danger else ButtonVariant.DangerSoft)
            }
            PosButton(
                "${if (editing == null) "Add" else "Update"} · ${formatPrice(unit * quantity)}",
                onClick = { onSubmit(options, quantity, notes) },
                enabled = missing == null && cap >= 1,
                haptic = true,
                modifier = Modifier.widthIn(min = 200.dp),
            )
        }
    }
}

@Composable
private fun OptionTile(option: ModifierOption, selected: Boolean, onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    Row(
        modifier = Modifier
            .width(212.dp)
            .height(56.dp)
            .pressable(interaction)
            .clip(RoundedCornerShape(Pos.Radius))
            .background(if (selected) Pos.PrimarySoft else Pos.Surface)
            .border(if (selected) 1.5.dp else 1.dp, if (selected) Pos.Primary else Pos.Line, RoundedCornerShape(Pos.Radius))
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = Pos.Space3),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Pos.Space2),
    ) {
        AnimatedVisibility(visible = selected, enter = scaleIn() + fadeIn(), exit = scaleOut() + fadeOut()) {
            Icon(Icons.Outlined.Check, contentDescription = null, tint = Pos.Primary, modifier = Modifier.size(16.dp))
        }
        Column {
            Text(option.name, style = if (selected) PosType.Label else PosType.Body, color = Pos.Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (option.priceDelta != 0.0) Text("+${formatPrice(option.priceDelta)}", style = PosType.Caption, color = Pos.Muted)
        }
    }
}

// ---------- Diskon ----------

// Baris diskon di panel pesanan: tombol tambah, atau label + potongan + hapus.
@Composable
private fun DiscountRow(state: PosUiState, onOpen: () -> Unit, onRemove: () -> Unit) {
    val pricing = state.pricing
    val available = state.promoOptions.count { it.discount > 0 }
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().heightIn(min = 32.dp)) {
        if (pricing.discount > 0) {
            // Diskon/kupon terpasang = tag yang bisa dilepas: ketuk tag untuk mengganti,
            // × di dalam tag untuk menghapus. Nominal tetap sejajar kolom angka.
            Text("Discount", style = PosType.BodySmall, color = Pos.Text, modifier = Modifier.weight(1f))
            Row(
                modifier = Modifier
                    .widthIn(max = 260.dp)
                    .height(30.dp)
                    .clip(CircleShape)
                    .background(Pos.SuccessSoft)
                    .clickable(onClick = onOpen)
                    .padding(start = Pos.Space3, end = 3.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon(Icons.Outlined.Sell, contentDescription = null, tint = Pos.Success, modifier = Modifier.size(14.dp))
                Text(pricing.discountLabel ?: "Discount", style = PosType.Micro.copy(fontWeight = PosType.Label.fontWeight), color = Pos.Success, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                Text("−${formatPrice(pricing.discount)}", style = PosType.Micro.copy(fontWeight = PosType.Label.fontWeight), color = Pos.Success, maxLines = 1)
                Box(
                    modifier = Modifier.size(24.dp).clip(CircleShape).clickable(onClickLabel = "Remove discount", onClick = onRemove),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Outlined.Close, contentDescription = "Remove discount", tint = Pos.Success, modifier = Modifier.size(14.dp))
                }
            }
        } else {
            Text(
                if (available > 0) "Add discount · $available promo${if (available > 1) "s" else ""} available" else "Add discount",
                style = PosType.BodySmall,
                color = if (state.cart.isEmpty()) Pos.Subtle else Pos.PrimaryPressed,
                modifier = Modifier.weight(1f).clickable(enabled = state.cart.isNotEmpty(), onClick = onOpen).padding(vertical = Pos.Space1),
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DiscountDialog(state: PosUiState, actions: PosActions, onDismiss: () -> Unit) {
    // Tab promo selalu pertama: di sana juga kolom kupon.
    var manual by remember { mutableStateOf(false) }
    var kind by remember { mutableStateOf("percent") }
    var digits by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val value = digits.toDoubleOrNull() ?: 0.0
    PosDialog(onDismiss = onDismiss, width = 620.dp) {
        DialogHeader("Discount", "One discount per order. Subtotal ${formatPrice(state.pricing.subtotal)}.", onClose = onDismiss)
        Segmented(
            options = listOf("promo" to "Promotions", "manual" to "Manual discount"),
            selected = if (manual) "manual" else "promo",
            onSelect = { manual = it == "manual" },
            modifier = Modifier.fillMaxWidth().padding(start = Pos.Space6, end = Pos.Space6, top = Pos.Space5),
        )
        DialogBody(Pos.Space3) {
            if (!manual) {
                var coupon by remember { mutableStateOf("") }
                Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Pos.Space2)) {
                    // Teks tidak diubah saat diketik: mengubahnya di tengah komposisi keyboard
                    // membuat huruf hilang ("hemat20" jadi "HM0"). Kode dinormalkan saat Apply;
                    // Ascii mematikan autocorrect supaya kode tidak "dibetulkan".
                    val ready = PromoRules.normalizeCode(coupon) != null
                    PosTextField(coupon, { coupon = it.take(32) }, "Coupon code", placeholder = "e.g. HEMAT20",
                        keyboardType = androidx.compose.ui.text.input.KeyboardType.Ascii, capitalization = androidx.compose.ui.text.input.KeyboardCapitalization.Characters,
                        onImeAction = { if (ready) { actions.applyCoupon(coupon); onDismiss() } }, modifier = Modifier.weight(1f))
                    PosButton("Apply", onClick = { actions.applyCoupon(coupon); onDismiss() }, variant = ButtonVariant.Secondary, enabled = ready)
                }
                if (state.promoOptions.isEmpty()) {
                    EmptyState("No automatic promos right now")
                }
                state.promoOptions.sortedByDescending { it.discount }.forEach { option ->
                    val eligible = option.discount > 0
                    PosCard(
                        onClick = if (eligible) ({ actions.applyPromo(option.promo.id); onDismiss() }) else null,
                        selected = state.pricing.discountLabel == option.promo.name,
                        padding = PaddingValues(Pos.Space4),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Pos.Space3)) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(option.promo.name, style = PosType.Label, color = if (eligible) Pos.Ink else Pos.Subtle)
                                Text(promoRuleText(option.promo), style = PosType.Caption, color = Pos.Muted)
                            }
                            Text(if (eligible) "−${formatPrice(option.discount)}" else "Not eligible", style = PosType.Label, color = if (eligible) Pos.Success else Pos.Subtle)
                        }
                    }
                }
            } else {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Pos.Space2)) {
                    ChoiceChip("Percent", selected = kind == "percent", onClick = { kind = "percent"; digits = "" })
                    ChoiceChip("Rupiah", selected = kind == "amount", onClick = { kind = "amount"; digits = "" })
                }
                PosTextField(
                    digits, { digits = it.filter(Char::isDigit).take(if (kind == "percent") 3 else 9) },
                    if (kind == "percent") "Discount (%)" else "Discount (Rp)", keyboardType = androidx.compose.ui.text.input.KeyboardType.Number,
                    placeholder = if (kind == "percent") "e.g. 10" else "e.g. 5000",
                )
                ApprovalFields(
                    reason = reason, onReason = { reason = it; error = null }, password = password, onPassword = { password = it; error = null }, needsApproval = !state.canManage,
                    quickReasons = listOf("Loyal customer", "Complaint", "Staff meal", "Owner's guest"), error = error,
                )
            }
        }
        if (manual) {
            DialogFooter(hint = error, hintTone = Tone.Danger) {
                PosButton("Cancel", onClick = onDismiss, variant = ButtonVariant.Secondary)
                PosButton(
                    "Apply discount",
                    onClick = { actions.applyManualDiscount(kind, value, reason, password) { failed -> if (failed == null) onDismiss() else error = failed } },
                    enabled = value > 0 && (kind != "percent" || value <= 100) && reason.isNotBlank() && (state.canManage || password.length == 6),
                    loading = state.isBusy,
                )
            }
        }
    }
}

private fun promoRuleText(promo: id.mangalli.pos.offline.Promo): String = listOfNotNull(
    if (promo.kind == "percent") "${if (promo.value % 1.0 == 0.0) promo.value.toLong() else promo.value}% off" else "${formatPrice(promo.value)} off",
    when (promo.scope) {
        "category" -> promo.categoryNames.joinToString(", ")
        "product" -> "${promo.productIds.size} product${if (promo.productIds.size == 1) "" else "s"}"
        else -> "whole order"
    },
    promo.maxDiscount?.takeIf { promo.kind == "percent" }?.let { "up to ${formatPrice(it)}" },
    promo.minSubtotal.takeIf { it > 0 }?.let { "min. ${formatPrice(it)}" },
).joinToString(" · ")
