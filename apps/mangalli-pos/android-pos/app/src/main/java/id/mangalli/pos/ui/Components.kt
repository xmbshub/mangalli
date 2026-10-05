package id.mangalli.pos.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Backspace
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.delay

// Komponen dasar tablet. Semua layar memakai komponen ini supaya tombol,
// kartu, input, dan dialog selalu sama bentuk, jarak, dan perilakunya.

// Umpan balik tekan: sedikit mengecil saat ditekan, kembali dengan pegas.
@Composable
fun Modifier.pressable(interaction: MutableInteractionSource, enabled: Boolean = true): Modifier {
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed && enabled) 0.97f else 1f,
        animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium),
        label = "press-scale",
    )
    return this.scale(scale)
}

enum class ButtonVariant { Primary, Secondary, Ghost, Danger, DangerSoft }
enum class ButtonSize { Large, Medium, Small }

@Composable
fun PosButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: ButtonVariant = ButtonVariant.Primary,
    size: ButtonSize = ButtonSize.Medium,
    icon: ImageVector? = null,
    enabled: Boolean = true,
    loading: Boolean = false,
    haptic: Boolean = false,
) {
    val interaction = remember { MutableInteractionSource() }
    val haptics = LocalHapticFeedback.current
    val active = enabled && !loading
    val (container, content, border) = when (variant) {
        ButtonVariant.Primary -> Triple(Pos.Primary, Color.White, null)
        ButtonVariant.Secondary -> Triple(Pos.Surface, Pos.Ink, Pos.Line)
        ButtonVariant.Ghost -> Triple(Color.Transparent, Pos.Text, null)
        ButtonVariant.Danger -> Triple(Pos.Danger, Color.White, null)
        ButtonVariant.DangerSoft -> Triple(Pos.DangerSoft, Pos.Danger, null)
    }
    val pressed by interaction.collectIsPressedAsState()
    val background by animateColorAsState(
        targetValue = when {
            !enabled -> if (variant == ButtonVariant.Primary || variant == ButtonVariant.Danger) Pos.Line else container
            pressed && variant == ButtonVariant.Primary -> Pos.PrimaryPressed
            pressed && variant != ButtonVariant.Danger -> Pos.LineSoft
            else -> container
        },
        animationSpec = tween(120),
        label = "button-background",
    )
    val height = when (size) {
        ButtonSize.Large -> Pos.ControlLarge
        ButtonSize.Medium -> Pos.Control
        ButtonSize.Small -> Pos.ControlSmall
    }
    val foreground = if (enabled) content else Pos.Subtle
    Box(
        modifier = modifier
            .pressable(interaction, active)
            .height(height)
            .clip(RoundedCornerShape(Pos.Radius))
            .background(background)
            .then(if (border != null) Modifier.border(1.dp, border, RoundedCornerShape(Pos.Radius)) else Modifier)
            .clickable(interactionSource = interaction, indication = null, enabled = active) {
                if (haptic) haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                onClick()
            }
            .padding(horizontal = if (size == ButtonSize.Small) Pos.Space3 else Pos.Space4),
        contentAlignment = Alignment.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Pos.Space2)) {
            if (loading) {
                CircularProgressIndicator(modifier = Modifier.size(16.dp), color = foreground, strokeWidth = 2.dp)
            } else if (icon != null) {
                Icon(icon, contentDescription = null, tint = foreground, modifier = Modifier.size(if (size == ButtonSize.Small) 16.dp else 18.dp))
            }
            Text(text, style = if (size == ButtonSize.Small) PosType.Caption.copy(fontWeight = PosType.Label.fontWeight) else PosType.Label, color = foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
fun PosIconButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tint: Color = Pos.Text,
    outlined: Boolean = true,
    enabled: Boolean = true,
    badge: Int = 0,
    // Compact = 32 dp, untuk baris rapat (panel pesanan, ringkasan total);
    // ukuran penuh untuk header dan toolbar.
    compact: Boolean = false,
) {
    val interaction = remember { MutableInteractionSource() }
    Box(modifier = modifier.pressable(interaction, enabled)) {
        Box(
            modifier = Modifier
                .size(if (compact) 32.dp else Pos.Control)
                .clip(CircleShape)
                .background(Pos.Surface)
                .then(if (outlined) Modifier.border(1.dp, Pos.Line, CircleShape) else Modifier)
                .clickable(interactionSource = interaction, indication = null, enabled = enabled, onClick = onClick),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = contentDescription, tint = if (enabled) tint else Pos.Subtle, modifier = Modifier.size(if (compact) 16.dp else 20.dp))
        }
        if (badge > 0) CountBadge(badge, modifier = Modifier.align(Alignment.TopEnd))
    }
}

@Composable
fun CountBadge(count: Int, modifier: Modifier = Modifier, color: Color = Pos.Primary) {
    Box(
        modifier = modifier
            .heightIn(min = 18.dp)
            .widthIn(min = 18.dp)
            .clip(CircleShape)
            .background(color)
            .padding(horizontal = 5.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(if (count > 99) "99+" else count.toString(), style = PosType.Micro, color = Color.White)
    }
}

// Kartu standar: putih, sudut 16, garis 1dp, tanpa bayangan. Kartu yang
// sejajar diberi tinggi sama oleh pemanggil (fillMaxHeight dalam Row).
@Composable
fun PosCard(
    modifier: Modifier = Modifier,
    padding: PaddingValues = PaddingValues(Pos.Space5),
    onClick: (() -> Unit)? = null,
    selected: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    val interaction = remember { MutableInteractionSource() }
    val border by animateColorAsState(if (selected) Pos.Primary else Pos.Line, Pos.QuickColor, label = "card-border")
    Column(
        modifier = modifier
            .then(if (onClick != null) Modifier.pressable(interaction) else Modifier)
            .clip(RoundedCornerShape(Pos.RadiusCard))
            .background(if (selected) Pos.PrimarySoft else Pos.Surface)
            .border(1.dp, border, RoundedCornerShape(Pos.RadiusCard))
            .then(if (onClick != null) Modifier.clickable(interactionSource = interaction, indication = null, onClick = onClick) else Modifier)
            .padding(padding),
        content = content,
    )
}

@Composable
fun CardHeader(title: String, subtitle: String? = null, action: (@Composable () -> Unit)? = null) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = PosType.Heading, color = Pos.Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (subtitle != null) Text(subtitle, style = PosType.Caption, color = Pos.Muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        action?.invoke()
    }
}

@Composable
fun ScreenHeader(title: String, subtitle: String? = null, actions: @Composable RowScope.() -> Unit = {}) {
    Row(modifier = Modifier.fillMaxWidth().height(56.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = PosType.Title, color = Pos.Ink)
            if (subtitle != null) Text(subtitle, style = PosType.Caption, color = Pos.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Pos.Space2), verticalAlignment = Alignment.CenterVertically, content = actions)
    }
}

@Composable
fun Pill(text: String, tone: Tone = Tone.Neutral, icon: ImageVector? = null, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .height(24.dp)
            .clip(CircleShape)
            .background(tone.background())
            .padding(horizontal = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (icon != null) Icon(icon, contentDescription = null, tint = tone.foreground(), modifier = Modifier.size(13.dp))
        Text(text, style = PosType.Micro, color = tone.foreground(), maxLines = 1)
    }
}

@Composable
fun StatusDot(color: Color, modifier: Modifier = Modifier) {
    Box(modifier = modifier.size(8.dp).clip(CircleShape).background(color))
}

@Composable
fun Avatar(name: String, size: Dp = 36.dp, selected: Boolean = false) {
    Box(
        modifier = Modifier
            .size(size)
            .clip(CircleShape)
            .background(if (selected) Pos.Primary else Pos.PrimarySoftStrong),
        contentAlignment = Alignment.Center,
    ) {
        Text(initials(name), style = if (size > 44.dp) PosType.Heading else PosType.Label, color = if (selected) Color.White else Pos.PrimaryPressed)
    }
}

@Composable
fun PosTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    keyboardType: KeyboardType = KeyboardType.Text,
    imeAction: ImeAction = ImeAction.Done,
    onImeAction: (() -> Unit)? = null,
    password: Boolean = false,
    error: String? = null,
    capitalization: KeyboardCapitalization = KeyboardCapitalization.None,
    focusRequester: FocusRequester? = null,
    singleLine: Boolean = true,
    minLines: Int = 1,
    leadingIcon: ImageVector? = null,
    enabled: Boolean = true,
    // Bingkai merah tanpa teks di bawahnya; pesannya tampil di footer dialog.
    highlightError: Boolean = false,
) {
    val focus = LocalFocusManager.current
    var reveal by remember { mutableStateOf(false) }
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, style = PosType.Caption.copy(fontWeight = PosType.Label.fontWeight), color = Pos.Text)
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier
                .fillMaxWidth()
                .then(if (focusRequester != null) Modifier.focusRequester(focusRequester) else Modifier),
            placeholder = placeholder?.let { { Text(it, style = PosType.Body, color = Pos.Subtle) } },
            textStyle = PosType.Body.copy(color = Pos.Ink),
            singleLine = singleLine,
            minLines = minLines,
            enabled = enabled,
            isError = error != null || highlightError,
            leadingIcon = leadingIcon?.let { { Icon(it, contentDescription = null, tint = Pos.Muted, modifier = Modifier.size(18.dp)) } },
            trailingIcon = if (password) {
                {
                    Icon(
                        if (reveal) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                        contentDescription = if (reveal) "Hide password" else "Show password",
                        tint = Pos.Muted,
                        modifier = Modifier.size(20.dp).clip(CircleShape).clickable { reveal = !reveal },
                    )
                }
            } else null,
            visualTransformation = if (password && !reveal) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(
                keyboardType = if (password && keyboardType == KeyboardType.Text) KeyboardType.Password else keyboardType,
                imeAction = imeAction,
                capitalization = capitalization,
                autoCorrectEnabled = !password && keyboardType == KeyboardType.Text,
            ),
            keyboardActions = KeyboardActions(
                onNext = { if (onImeAction != null) onImeAction() else focus.moveFocus(androidx.compose.ui.focus.FocusDirection.Down) },
                onDone = { focus.clearFocus(); onImeAction?.invoke() },
                onSearch = { focus.clearFocus(); onImeAction?.invoke() },
                onGo = { focus.clearFocus(); onImeAction?.invoke() },
            ),
            shape = RoundedCornerShape(Pos.Radius),
            colors = fieldColors(),
        )
        if (error != null) Text(error, style = PosType.Caption, color = Pos.Danger)
    }
}

@Composable
fun SearchField(value: String, onValueChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier) {
    val focus = LocalFocusManager.current
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier.heightIn(min = Pos.Control),
        placeholder = { Text(placeholder, style = PosType.Body, color = Pos.Subtle) },
        textStyle = PosType.Body.copy(color = Pos.Ink),
        singleLine = true,
        leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null, tint = Pos.Muted, modifier = Modifier.size(18.dp)) },
        trailingIcon = if (value.isNotEmpty()) {
            { Icon(Icons.Outlined.Close, contentDescription = "Clear search", tint = Pos.Muted, modifier = Modifier.size(18.dp).clip(CircleShape).clickable { onValueChange("") }) }
        } else null,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        keyboardActions = KeyboardActions(onSearch = { focus.clearFocus() }),
        shape = RoundedCornerShape(Pos.Radius),
        colors = fieldColors(),
    )
}

@Composable
private fun fieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = Pos.Primary,
    unfocusedBorderColor = Pos.Line,
    errorBorderColor = Pos.Danger,
    cursorColor = Pos.Primary,
    focusedContainerColor = Pos.Surface,
    unfocusedContainerColor = Pos.Surface,
    disabledContainerColor = Pos.SurfaceMuted,
)

// Pilihan bersebelahan (Takeaway/Dine in, metode bayar, filter).
@Composable
fun Segmented(
    options: List<Pair<String, String>>,
    selected: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
    height: Dp = 40.dp,
) {
    Row(
        modifier = modifier
            .height(height)
            .clip(RoundedCornerShape(Pos.Radius))
            .background(Pos.LineSoft)
            .padding(3.dp),
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        options.forEach { (value, label) ->
            val active = value == selected
            val background by animateColorAsState(if (active) Pos.Surface else Color.Transparent, Pos.QuickColor, label = "segment-bg")
            val foreground by animateColorAsState(if (active) Pos.Ink else Pos.Muted, Pos.QuickColor, label = "segment-fg")
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(Pos.Radius - 3.dp))
                    .background(background)
                    .then(if (active) Modifier.border(1.dp, Pos.Line, RoundedCornerShape(Pos.Radius - 3.dp)) else Modifier)
                    .clickable { onSelect(value) },
                contentAlignment = Alignment.Center,
            ) {
                Text(label, style = if (active) PosType.Label else PosType.Body, color = foreground, maxLines = 1)
            }
        }
    }
}

// Chip pilihan (kategori, jumlah uang cepat, meja).
@Composable
fun ChoiceChip(text: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, icon: ImageVector? = null, iconTint: Color? = null) {
    val interaction = remember { MutableInteractionSource() }
    val background by animateColorAsState(if (selected) Pos.Ink else Pos.Surface, Pos.QuickColor, label = "chip-bg")
    val foreground by animateColorAsState(if (selected) Color.White else if (enabled) Pos.Text else Pos.Subtle, Pos.QuickColor, label = "chip-fg")
    Box(
        modifier = modifier
            .pressable(interaction, enabled)
            .height(Pos.ControlSmall + 4.dp)
            .clip(CircleShape)
            .background(background)
            .border(1.dp, if (selected) Pos.Ink else Pos.Line, CircleShape)
            .clickable(interactionSource = interaction, indication = null, enabled = enabled, onClick = onClick)
            .padding(horizontal = Pos.Space4),
        contentAlignment = Alignment.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            if (icon != null) Icon(icon, contentDescription = null, tint = if (selected) Color.White else iconTint ?: foreground, modifier = Modifier.size(16.dp))
            Text(text, style = if (selected) PosType.Label else PosType.Body, color = foreground, maxLines = 1)
        }
    }
}

// Tampilan kosong: satu baris pendek abu-abu di tengah, tanpa ikon dan paragraf
// (standar owner, sama dengan dashboard). Aksi opsional tetap di bawahnya.
@Composable
fun EmptyState(title: String, modifier: Modifier = Modifier, action: (@Composable () -> Unit)? = null) {
    Column(
        modifier = modifier.padding(Pos.Space6),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Pos.Space3, Alignment.CenterVertically),
    ) {
        Text(title, style = PosType.BodySmall, color = Pos.Muted, textAlign = TextAlign.Center)
        action?.invoke()
    }
}

@Composable
fun KeyValue(label: String, value: String, emphasize: Boolean = false, valueColor: Color = Pos.Ink) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = if (emphasize) PosType.Label else PosType.BodySmall, color = if (emphasize) Pos.Ink else Pos.Muted, modifier = Modifier.weight(1f))
        Text(value, style = if (emphasize) PosType.AmountSmall else PosType.BodySmall, color = valueColor, maxLines = 1)
    }
}

@Composable
fun HorizontalLine(modifier: Modifier = Modifier) {
    Box(modifier = modifier.fillMaxWidth().height(1.dp).background(Pos.Line))
}

@Composable
fun QuantityStepper(quantity: Int, onMinus: () -> Unit, onPlus: () -> Unit, modifier: Modifier = Modifier, compact: Boolean = false) {
    // Target ketuk minimal 44 dp (owner: tombol lama 32 dp mudah salah tekan);
    // tombol lebih lebar daripada tinggi supaya jari tidak meleset ke angka.
    val height = if (compact) Pos.Control else Pos.ControlLarge
    val keyWidth = if (compact) 48.dp else 56.dp
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(Pos.Radius))
            .border(1.dp, Pos.Line, RoundedCornerShape(Pos.Radius)),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StepperKey("−", "Decrease quantity", keyWidth, height, onMinus)
        Text(quantity.toString(), style = PosType.Label, color = Pos.Ink, textAlign = TextAlign.Center, modifier = Modifier.width(if (compact) 36.dp else 44.dp))
        StepperKey("+", "Increase quantity", keyWidth, height, onPlus)
    }
}

@Composable
private fun StepperKey(label: String, description: String, width: Dp, height: Dp, onClick: () -> Unit) {
    val haptics = LocalHapticFeedback.current
    Box(
        modifier = Modifier
            .size(width, height)
            .clickable(onClickLabel = description) {
                haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                onClick()
            },
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = PosType.Heading, color = Pos.Ink)
    }
}

// Papan angka untuk uang: tanpa keyboard sistem, tombol besar untuk jari.
@Composable
fun Numpad(onKey: (String) -> Unit, onBackspace: () -> Unit, modifier: Modifier = Modifier) {
    val haptics = LocalHapticFeedback.current
    val rows = listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf("00", "0", "⌫"))
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(Pos.Space2)) {
        rows.forEach { row ->
            Row(modifier = Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Pos.Space2)) {
                row.forEach { key ->
                    val interaction = remember { MutableInteractionSource() }
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxHeight()
                            .pressable(interaction)
                            .clip(RoundedCornerShape(Pos.Radius))
                            .background(Pos.SurfaceMuted)
                            .border(1.dp, Pos.Line, RoundedCornerShape(Pos.Radius))
                            .clickable(interactionSource = interaction, indication = null) {
                                haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                if (key == "⌫") onBackspace() else onKey(key)
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        if (key == "⌫") Icon(Icons.Outlined.Backspace, contentDescription = "Delete", tint = Pos.Text, modifier = Modifier.size(22.dp))
                        else Text(key, style = PosType.AmountSmall.copy(fontWeight = PosType.Body.fontWeight), color = Pos.Ink)
                    }
                }
            }
        }
    }
}

fun appendDigits(current: String, key: String, maxDigits: Int = 10): String =
    (current + key).trimStart('0').take(maxDigits)

// Dialog standar: panel putih di tengah, sudut 20, latar gelap tipis.
// Tinggi mengikuti isi sampai 88% layar; ketuk di luar untuk menutup.
@Composable
fun PosDialog(onDismiss: () -> Unit, width: Dp = 560.dp, fixedHeight: Dp? = null, dismissOnOutside: Boolean = true, content: @Composable ColumnScope.() -> Unit) {
    val screenHeight = LocalConfiguration.current.screenHeightDp.dp
    // Lepas fokus layar di belakang (mis. kolom nama pelanggan); kalau tidak,
    // keyboard muncul lagi untuk kolom itu setiap kali dialog ditutup.
    val screenFocus = LocalFocusManager.current
    LaunchedEffect(Unit) { screenFocus.clearFocus() }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnClickOutside = dismissOnOutside, decorFitsSystemWindows = false)) {
        // Tinggi dialog dihitung dari ruang di atas keyboard (imePadding), bukan
        // dari tinggi layar, supaya kolom yang sedang diisi tidak tertutup.
        BoxWithConstraints(
            modifier = Modifier
                .fillMaxSize()
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, enabled = dismissOnOutside, onClick = onDismiss)
                .imePadding()
                .padding(Pos.Space6),
            contentAlignment = Alignment.Center,
        ) {
            val available = maxHeight
            Surface(
                modifier = Modifier
                    .widthIn(max = width)
                    .fillMaxWidth()
                    .then(
                        if (fixedHeight != null) Modifier.height(minOf(fixedHeight, screenHeight * 0.9f, available))
                        else Modifier.heightIn(max = minOf(screenHeight * 0.9f, available))
                    )
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {},
                shape = RoundedCornerShape(Pos.RadiusSheet),
                color = Pos.Surface,
                shadowElevation = 24.dp,
            ) {
                Column(content = content)
            }
        }
    }
}

// Isi dialog di antara DialogHeader dan DialogFooter. Bagian ini yang
// menyusut dan bisa digulir saat keyboard terbuka; kolom yang difokuskan
// digulir masuk ke layar, sementara judul dan tombol tetap terlihat.
@Composable
fun ColumnScope.DialogBody(spacing: Dp = Pos.Space4, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(Pos.Space6),
        verticalArrangement = Arrangement.spacedBy(spacing),
        content = content,
    )
}

@Composable
fun DialogHeader(title: String, subtitle: String? = null, onClose: (() -> Unit)?, leading: (@Composable () -> Unit)? = null) {
    // Atas, kanan, dan bawah sama 16 dp: tombol tutup berjarak sama dari sudut
    // dialog, seperti panel di dashboard dan Studio.
    Row(
        modifier = Modifier.fillMaxWidth().padding(start = Pos.Space6, end = Pos.Space4, top = Pos.Space4, bottom = Pos.Space4),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Pos.Space3),
    ) {
        leading?.invoke()
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = PosType.Title, color = Pos.Ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (subtitle != null) Text(subtitle, style = PosType.BodySmall, color = Pos.Muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        if (onClose != null) PosIconButton(Icons.Outlined.Close, "Close", onClose, outlined = false)
    }
    HorizontalLine()
}

@Composable
fun DialogFooter(hint: String? = null, hintTone: Tone = Tone.Neutral, content: @Composable RowScope.() -> Unit) {
    HorizontalLine()
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = Pos.Space6, vertical = Pos.Space4),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Pos.Space3),
    ) {
        if (hint != null) Text(hint, style = PosType.Caption, color = if (hintTone == Tone.Neutral) Pos.Muted else hintTone.foreground(), modifier = Modifier.weight(1f))
        else Spacer(Modifier.weight(1f))
        content()
    }
}

@Composable
fun ConfirmDialog(
    title: String,
    body: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    danger: Boolean = false,
    cancelLabel: String = "Keep",
) {
    PosDialog(onDismiss = onDismiss, width = 440.dp) {
        Column(modifier = Modifier.padding(Pos.Space6), verticalArrangement = Arrangement.spacedBy(Pos.Space2)) {
            Text(title, style = PosType.Title, color = Pos.Ink)
            Text(body, style = PosType.Body, color = Pos.Muted)
        }
        Row(modifier = Modifier.fillMaxWidth().padding(start = Pos.Space6, end = Pos.Space6, bottom = Pos.Space6), horizontalArrangement = Arrangement.spacedBy(Pos.Space3)) {
            PosButton(cancelLabel, onClick = onDismiss, variant = ButtonVariant.Secondary, modifier = Modifier.weight(1f))
            PosButton(confirmLabel, onClick = { onDismiss(); onConfirm() }, variant = if (danger) ButtonVariant.Danger else ButtonVariant.Primary, modifier = Modifier.weight(1f), haptic = true)
        }
    }
}

// Notifikasi singkat di atas layar; hilang sendiri. Error bertahan lebih lama.
@Composable
fun BoxScope.ToastHost(toast: ToastMessage?, onDismiss: () -> Unit) {
    var visible by remember { mutableStateOf<ToastMessage?>(null) }
    LaunchedEffect(toast?.id) {
        if (toast == null) return@LaunchedEffect
        visible = toast
        delay(if (toast.tone == Tone.Danger) 4_500 else 2_600)
        visible = null
        onDismiss()
    }
    AnimatedVisibility(
        visible = visible != null,
        enter = slideInVertically { -it } + fadeIn(),
        exit = slideOutVertically { -it } + fadeOut(),
        modifier = Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(top = Pos.Space4),
    ) {
        val message = visible ?: toast ?: return@AnimatedVisibility
        Row(
            modifier = Modifier
                .widthIn(max = 560.dp)
                .clip(RoundedCornerShape(Pos.RadiusCard))
                .background(Pos.Ink)
                .clickable { visible = null; onDismiss() }
                .padding(horizontal = Pos.Space4, vertical = Pos.Space3),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Pos.Space2),
        ) {
            Icon(
                when (message.tone) {
                    Tone.Danger, Tone.Warning -> Icons.Outlined.ErrorOutline
                    Tone.Success -> Icons.Outlined.CheckCircle
                    else -> Icons.Outlined.Info
                },
                contentDescription = null,
                tint = when (message.tone) {
                    Tone.Danger -> Color(0xFFFCA5A5)
                    Tone.Warning -> Color(0xFFFCD34D)
                    Tone.Success -> Color(0xFF86EFAC)
                    else -> Color.White
                },
                modifier = Modifier.size(18.dp),
            )
            Text(message.text, style = PosType.BodySmall, color = Color.White, maxLines = 3, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(text.uppercase(), style = PosType.Micro.copy(letterSpacing = PosType.Micro.letterSpacing), color = Pos.Muted, modifier = modifier)
}

@Composable
fun InfoBanner(text: String, tone: Tone = Tone.Primary, modifier: Modifier = Modifier, action: (@Composable () -> Unit)? = null) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Pos.Radius))
            .background(tone.background())
            .border(1.dp, if (tone == Tone.Primary) Pos.PrimaryLine else Color.Transparent, RoundedCornerShape(Pos.Radius))
            .padding(horizontal = Pos.Space4, vertical = Pos.Space3),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Pos.Space3),
    ) {
        Icon(if (tone == Tone.Danger || tone == Tone.Warning) Icons.Outlined.ErrorOutline else Icons.Outlined.Info, contentDescription = null, tint = tone.foreground(), modifier = Modifier.size(18.dp))
        Text(text, style = PosType.BodySmall, color = Pos.Ink, modifier = Modifier.weight(1f))
        action?.invoke()
    }
}

val SelectedBorder = BorderStroke(1.5.dp, Pos.Primary)

// Alasan + persetujuan untuk tindakan berisiko (void, refund, diskon manual,
// bawa bill ke shift berikutnya). Kasir memasukkan PIN persetujuan 6 digit milik
// manager/owner (diatur di dashboard Team, terpisah dari password); owner/manager
// cukup memberi alasan.
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun ApprovalFields(
    reason: String,
    onReason: (String) -> Unit,
    password: String,
    onPassword: (String) -> Unit,
    needsApproval: Boolean,
    quickReasons: List<String>,
    reasonLabel: String = "Reason",
    // Galat aksi (mis. PIN salah): kolom diberi bingkai merah, pesannya di DialogFooter.
    error: String? = null,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Pos.Space3)) {
        if (quickReasons.isNotEmpty()) {
            androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(Pos.Space2), verticalArrangement = Arrangement.spacedBy(Pos.Space2)) {
                quickReasons.forEach { option -> ChoiceChip(option, selected = reason == option, onClick = { onReason(option) }) }
            }
        }
        PosTextField(reason, { onReason(it.take(200)) }, reasonLabel, placeholder = "Write a short reason", capitalization = androidx.compose.ui.text.input.KeyboardCapitalization.Sentences, highlightError = error != null && !needsApproval)
        if (needsApproval) {
            PosTextField(password, { onPassword(it.filter(Char::isDigit).take(6)) }, "Manager PIN", placeholder = "6 digits", password = true, keyboardType = KeyboardType.NumberPassword, highlightError = error != null)
            Text("Approved by a manager, logged with their name.", style = PosType.Caption, color = Pos.Muted)
        } else {
            Text("Recorded in the audit log with your name.", style = PosType.Caption, color = Pos.Muted)
        }
    }
}
