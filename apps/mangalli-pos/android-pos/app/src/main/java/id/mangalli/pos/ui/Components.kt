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
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
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
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.ModalBottomSheetProperties
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedIconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SheetValue
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
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
    // Teredam kritis (audit apple-design 15 Okt 2026): tombol kembali ke ukurannya
    // tanpa memantul. Pantulan hanya pantas sesudah gerak lempar, bukan ketukan.
    val scale by animateFloatAsState(
        targetValue = if (pressed && enabled) 0.97f else 1f,
        animationSpec = spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessMedium),
        label = "press-scale",
    )
    return this.scale(scale)
}

enum class ButtonVariant { Primary, Secondary, Ghost, Danger, DangerSoft }

// Teks tombol mengikuti tinggi tombol: besar (52 dp) 16, sedang 14, kecil 12; semuanya Medium.
private fun buttonText(size: ButtonSize) = when (size) {
    ButtonSize.Large -> PosType.Heading
    ButtonSize.Medium -> PosType.Label
    ButtonSize.Small -> PosType.Caption.copy(fontWeight = FontWeight.Medium)
}
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
    val haptics = LocalHapticFeedback.current
    if (LocalCompact.current) {
        MaterialPosButton(text, { if (haptic) haptics.performHapticFeedback(HapticFeedbackType.VirtualKey); onClick() }, modifier, variant, size, icon, enabled, loading)
        return
    }
    val interaction = remember { MutableInteractionSource() }
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
                if (haptic) haptics.performHapticFeedback(HapticFeedbackType.VirtualKey)
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
            Text(text, style = buttonText(size), color = foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

// Kaki sheet ponsel: tombol di dalamnya membagi lebar sama rata (seperti tombol aksi
// bawah aplikasi Android) lewat weight dari FlowRow footer.
private val LocalFooterScope = androidx.compose.runtime.staticCompositionLocalOf<RowScope?> { null }

// Tombol Material bawaan untuk ponsel, dengan warna dan sudut design system.
@Composable
private fun MaterialPosButton(text: String, onClick: () -> Unit, modifier: Modifier, variant: ButtonVariant, size: ButtonSize, icon: ImageVector?, enabled: Boolean, loading: Boolean) {
    val shape = RoundedCornerShape(Pos.Radius)
    val footer = LocalFooterScope.current
    val height = when {
        footer != null || size == ButtonSize.Large -> Pos.ControlLarge
        size == ButtonSize.Medium -> Pos.Control
        else -> Pos.ControlSmall
    }
    val sized = (if (footer != null) with(footer) { modifier.weight(1f) } else modifier).heightIn(min = height)
    val padding = PaddingValues(horizontal = if (size == ButtonSize.Small) Pos.Space3 else Pos.Space4)
    val active = enabled && !loading
    val label: @Composable () -> Unit = {
        val tint = androidx.compose.material3.LocalContentColor.current
        if (loading) CircularProgressIndicator(modifier = Modifier.size(16.dp), color = tint, strokeWidth = 2.dp)
        else if (icon != null) Icon(icon, contentDescription = null, modifier = Modifier.size(if (size == ButtonSize.Small) 16.dp else 18.dp))
        if (loading || icon != null) Spacer(Modifier.width(Pos.Space2))
        Text(text, style = buttonText(if (footer != null) ButtonSize.Large else size), maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    when (variant) {
        ButtonVariant.Primary, ButtonVariant.Danger -> Button(
            onClick, sized, enabled = active, shape = shape, contentPadding = padding,
            colors = ButtonDefaults.buttonColors(containerColor = if (variant == ButtonVariant.Danger) Pos.Danger else Pos.Primary, contentColor = Color.White, disabledContainerColor = Pos.Line, disabledContentColor = Pos.Subtle),
        ) { label() }
        ButtonVariant.Secondary -> OutlinedButton(
            onClick, sized, enabled = active, shape = shape, contentPadding = padding, border = BorderStroke(1.dp, Pos.Line),
            colors = ButtonDefaults.outlinedButtonColors(containerColor = Pos.Surface, contentColor = Pos.Ink, disabledContentColor = Pos.Subtle),
        ) { label() }
        ButtonVariant.Ghost -> TextButton(
            onClick, sized, enabled = active, shape = shape, contentPadding = padding,
            colors = ButtonDefaults.textButtonColors(contentColor = Pos.Text, disabledContentColor = Pos.Subtle),
        ) { label() }
        ButtonVariant.DangerSoft -> FilledTonalButton(
            onClick, sized, enabled = active, shape = shape, contentPadding = padding,
            colors = ButtonDefaults.filledTonalButtonColors(containerColor = Pos.DangerSoft, contentColor = Pos.Danger, disabledContainerColor = Pos.LineSoft, disabledContentColor = Pos.Subtle),
        ) { label() }
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
    if (LocalCompact.current) {
        if (badge > 0 && !outlined) {
            Box(modifier) { BadgedIconButton(onClick, enabled, count = badge) { Icon(icon, contentDescription = contentDescription, tint = if (enabled) tint else Pos.Subtle, modifier = Modifier.size(20.dp)) } }
            return
        }
        val icon: @Composable () -> Unit = {
            if (badge > 0) IconWithBadge(count = badge, iconSize = 20.dp) { Icon(icon, contentDescription = contentDescription, modifier = Modifier.size(20.dp)) }
            else Icon(icon, contentDescription = contentDescription, modifier = Modifier.size(if (compact) 18.dp else 20.dp))
        }
        val colors = IconButtonDefaults.iconButtonColors(contentColor = tint, disabledContentColor = Pos.Subtle)
        if (outlined) OutlinedIconButton(onClick, modifier, enabled = enabled, border = BorderStroke(1.dp, Pos.Line), colors = IconButtonDefaults.outlinedIconButtonColors(contentColor = tint, disabledContentColor = Pos.Subtle)) { icon() }
        else IconButton(onClick, modifier, enabled = enabled, colors = colors) { icon() }
        return
    }
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

// Badge ikon (audit 15 Okt 2026, permintaan owner: titik sinkron dan angka di header
// ponsel belum simetris). Satu aturan untuk header dan bilah bawah ponsel serta rail
// tablet: pusat badge berada pada diagonal yang sama dari pusat ikon (titik 3 dp di
// dalam sudut ikon, angka 1 dp di luarnya), dan cincin 2 dp warna permukaan
// memisahkan badge dari garis ikon. Letakkan di atas ikon dengan Alignment.Center.
@Composable
fun IconBadge(count: Int = 0, dot: Color? = null, iconSize: Dp = 24.dp, countColor: Color = Pos.Primary, ring: Color = Pos.Surface) {
    val corner = iconSize / 2
    when {
        count > 0 -> CountBadge(count, color = countColor, ring = ring, modifier = Modifier.offset(x = corner + 1.dp, y = -(corner + 1.dp)))
        dot != null -> Box(
            modifier = Modifier
                .offset(x = corner - 3.dp, y = -(corner - 3.dp))
                .size(12.dp)
                .clip(CircleShape)
                .background(ring)
                .padding(2.dp)
                .clip(CircleShape)
                .background(dot),
        )
    }
}

/** Ikon dengan badge di sudut kanan atasnya, tanpa ikut terpotong bentuk tombol. */
@Composable
fun IconWithBadge(count: Int = 0, dot: Color? = null, iconSize: Dp = 24.dp, countColor: Color = Pos.Primary, ring: Color = Pos.Surface, icon: @Composable () -> Unit) {
    Box(contentAlignment = Alignment.Center) {
        icon()
        IconBadge(count, dot, iconSize, countColor, ring)
    }
}

/** Tombol ikon header ponsel dengan badge: riak 20 dp seperti IconButton, badge tidak dipotong. */
@Composable
fun BadgedIconButton(onClick: () -> Unit, enabled: Boolean = true, count: Int = 0, dot: Color? = null, countColor: Color = Pos.Primary, icon: @Composable () -> Unit) {
    Box(
        modifier = Modifier
            .size(48.dp)
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = ripple(bounded = false, radius = 20.dp), enabled = enabled, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        IconWithBadge(count, dot, countColor = countColor, icon = icon)
    }
}

@Composable
fun CountBadge(count: Int, modifier: Modifier = Modifier, color: Color = Pos.Primary, ring: Color = Pos.Surface) {
    Box(modifier = modifier.clip(CircleShape).background(ring).padding(2.dp)) {
        Box(
            modifier = Modifier
                .height(16.dp)
                .widthIn(min = 16.dp)
                .clip(CircleShape)
                .background(color)
                .padding(horizontal = 4.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(if (count > 99) "99+" else count.toString(), style = PosType.Badge, color = Color.White, maxLines = 1)
        }
    }
}

// Kartu standar: putih, sudut 16, garis 1dp, tanpa bayangan. Kartu yang
// sejajar diberi tinggi sama oleh pemanggil (fillMaxHeight dalam Row).
@Composable
fun PosCard(
    modifier: Modifier = Modifier,
    padding: PaddingValues = PaddingValues(if (LocalCompact.current) Pos.Space4 else Pos.Space5),
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
    // Ponsel: judul dan keterangan ada di TopAppBar (MobileShell).
    if (LocalCompact.current) return
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
    if (LocalCompact.current) {
        SingleChoiceSegmentedButtonRow(modifier = modifier) {
            options.forEachIndexed { index, (value, label) ->
                SegmentedButton(
                    selected = value == selected,
                    onClick = { onSelect(value) },
                    shape = SegmentedButtonDefaults.itemShape(index, options.size),
                    colors = SegmentedButtonDefaults.colors(
                        activeContainerColor = Pos.PrimarySoftStrong, activeContentColor = Pos.PrimaryPressed, activeBorderColor = Pos.Line,
                        inactiveContainerColor = Pos.Surface, inactiveContentColor = Pos.Text, inactiveBorderColor = Pos.Line,
                    ),
                    icon = {},
                    label = { Text(label, style = PosType.Label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                )
            }
        }
        return
    }
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
    if (LocalCompact.current) {
        FilterChip(
            selected = selected, onClick = onClick, enabled = enabled, modifier = modifier,
            // Tebal huruf sama saat dipilih: chip tidak melebar dan tetangganya tidak bergeser.
            label = { Text(text, style = PosType.Body, maxLines = 1) },
            leadingIcon = icon?.let { { Icon(it, contentDescription = null, tint = if (selected) Pos.PrimaryPressed else iconTint ?: Pos.Text, modifier = Modifier.size(16.dp)) } },
            shape = CircleShape,
            colors = FilterChipDefaults.filterChipColors(
                containerColor = Pos.Surface, labelColor = Pos.Text,
                selectedContainerColor = Pos.PrimarySoftStrong, selectedLabelColor = Pos.PrimaryPressed,
            ),
            border = FilterChipDefaults.filterChipBorder(enabled = enabled, selected = selected, borderColor = Pos.Line, selectedBorderColor = Pos.PrimaryLine, borderWidth = 1.dp, selectedBorderWidth = 1.dp),
        )
        return
    }
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
            Text(text, style = PosType.Body, color = foreground, maxLines = 1)
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

// Tepi gulir lembut (audit apple-design, permintaan owner 17 Okt 2026: batas antara
// kategori dan grid produk terlalu kasar). Isi yang tergulir memudar di tepi wadahnya
// selebar `fade`, bukan terpotong garis lurus; tiap tepi hanya memudar bila memang ada
// isi di baliknya (mis. LazyGridState.canScrollBackward / canScrollForward).
@Composable
fun Modifier.scrollEdgeFade(top: Boolean, bottom: Boolean, fade: Dp = 20.dp, horizontal: Boolean = false): Modifier {
    // horizontal = true: "top" = tepi kiri, "bottom" = tepi kanan (baris chip yang digeser).
    val startAlpha by animateFloatAsState(if (top) 1f else 0f, tween(160), label = "edge-start")
    val endAlpha by animateFloatAsState(if (bottom) 1f else 0f, tween(160), label = "edge-end")
    return this
        .graphicsLayer(compositingStrategy = CompositingStrategy.Offscreen)
        .drawWithContent {
            drawContent()
            val f = fade.toPx()
            val length = if (horizontal) size.width else size.height
            fun edge(from: Float, to: Float, alphaAtFrom: Float, alphaAtTo: Float) {
                val stops = arrayOf(0f to Color.Black.copy(alpha = alphaAtFrom), 1f to Color.Black.copy(alpha = alphaAtTo))
                val brush = if (horizontal) Brush.horizontalGradient(*stops, startX = from, endX = to) else Brush.verticalGradient(*stops, startY = from, endY = to)
                val topLeft = if (horizontal) Offset(minOf(from, to), 0f) else Offset(0f, minOf(from, to))
                drawRect(brush, topLeft = topLeft, size = if (horizontal) Size(f, size.height) else Size(size.width, f), blendMode = BlendMode.DstIn)
            }
            if (startAlpha > 0f) edge(0f, f, 1f - startAlpha, 1f)
            if (endAlpha > 0f) edge(length - f, length, 1f, 1f - endAlpha)
        }
}

// Pembungkus gulir dengan tepi lembut, satu pola untuk semua daftar layar, isi dialog,
// dan baris chip yang digeser (17 Okt 2026), sama dengan grid menu.
@Composable
fun FadingLazyColumn(
    modifier: Modifier = Modifier,
    state: LazyListState = rememberLazyListState(),
    contentPadding: PaddingValues = PaddingValues(0.dp),
    verticalArrangement: Arrangement.Vertical = Arrangement.Top,
    content: LazyListScope.() -> Unit,
) {
    LazyColumn(modifier = modifier.scrollEdgeFade(top = state.canScrollBackward, bottom = state.canScrollForward), state = state, contentPadding = contentPadding, verticalArrangement = verticalArrangement, content = content)
}

@Composable
fun Modifier.fadingVerticalScroll(state: ScrollState = rememberScrollState()): Modifier =
    scrollEdgeFade(top = state.canScrollBackward, bottom = state.canScrollForward).verticalScroll(state)

@Composable
fun Modifier.fadingHorizontalScroll(state: ScrollState = rememberScrollState()): Modifier =
    scrollEdgeFade(top = state.canScrollBackward, bottom = state.canScrollForward, fade = 28.dp, horizontal = true).horizontalScroll(state)

@Composable
fun HorizontalLine(modifier: Modifier = Modifier) {
    Box(modifier = modifier.fillMaxWidth().height(1.dp).background(Pos.Line))
}

@Composable
fun QuantityStepper(quantity: Int, onMinus: () -> Unit, onPlus: () -> Unit, modifier: Modifier = Modifier, compact: Boolean = false, minusEnabled: Boolean = true, plusEnabled: Boolean = true) {
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
        StepperKey("−", "Decrease quantity", keyWidth, height, onMinus, minusEnabled)
        Text(quantity.toString(), style = PosType.Label, color = Pos.Ink, textAlign = TextAlign.Center, modifier = Modifier.width(if (compact) 36.dp else 44.dp))
        StepperKey("+", "Increase quantity", keyWidth, height, onPlus, plusEnabled)
    }
}

@Composable
private fun StepperKey(label: String, description: String, width: Dp, height: Dp, onClick: () -> Unit, enabled: Boolean) {
    val haptics = LocalHapticFeedback.current
    // Di batas (1 atau sisa stok) tombol meredup, jadi kasir tahu tidak bisa ditambah lagi.
    Box(
        modifier = Modifier
            .size(width, height)
            .clickable(enabled = enabled, onClickLabel = description) {
                haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                onClick()
            },
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = PosType.Heading, color = if (enabled) Pos.Ink else Pos.Subtle)
    }
}

// Papan angka untuk uang: tanpa keyboard sistem, tombol besar untuk jari.
@Composable
fun Numpad(onKey: (String) -> Unit, onBackspace: () -> Unit, modifier: Modifier = Modifier) {
    val haptics = LocalHapticFeedback.current
    // Mengetuk papan angka menutup keyboard sistem yang masih terbuka (mis. sesudah
    // mengisi deskripsi), supaya papan tidak tertutup dan fokus tidak ganda.
    val focus = LocalFocusManager.current
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
                                haptics.performHapticFeedback(HapticFeedbackType.KeyboardTap)
                                focus.clearFocus()
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

// PIN 6 titik + papan angka besar, tanpa keyboard sistem (permintaan owner 5 Okt 2026,
// meniru layar passcode ponsel; sama dengan PinField di dashboard). Sesudah PIN lengkap
// ditolak (`error`), titik memerah dan bergetar, dan angka berikutnya memulai PIN baru.
// Galat lain dialog (alasan kosong, nominal) tidak menghapus PIN yang sedang diketik.
@Composable
fun PinPad(
    pin: String,
    onPin: (String) -> Unit,
    error: Boolean = false,
    label: String? = null,
    onComplete: ((String) -> Unit)? = null,
    modifier: Modifier = Modifier,
    // Baris status di antara titik dan papan (galat atau "Checking…"); tingginya
    // selalu disediakan supaya papan tidak melompat.
    status: String? = null,
    reserveStatus: Boolean = false,
) {
    val haptics = LocalHapticFeedback.current
    val shake = remember { androidx.compose.animation.core.Animatable(0f) }
    val rejected = error && pin.length == 6
    LaunchedEffect(error) {
        if (error) {
            // Getar "tolak" di frame yang sama dengan goyangan titik PIN.
            haptics.performHapticFeedback(HapticFeedbackType.Reject)
            listOf(-10f, 10f, -8f, 8f, -4f, 0f).forEach { shake.animateTo(it, tween(45)) }
        }
    }
    val press = { key: String ->
        haptics.performHapticFeedback(HapticFeedbackType.KeyboardTap)
        val next = when {
            key == "clear" -> ""
            key == "⌫" -> if (rejected) "" else pin.dropLast(1)
            rejected -> key
            else -> (pin + key).take(6)
        }
        onPin(next)
        if (next.length == 6 && key != "⌫" && key != "clear") onComplete?.invoke(next)
    }
    // Box selebar wadah supaya papan 340 dp benar-benar di tengah dialog.
    Box(modifier = modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) { Column(
        modifier = Modifier.widthIn(max = 340.dp).fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Pos.Space3),
    ) {
        if (label != null) Text(label, style = PosType.Label, color = Pos.Ink, modifier = Modifier.fillMaxWidth())
        PinDots(pin, error, Modifier.padding(vertical = Pos.Space2).graphicsLayer { translationX = shake.value.dp.toPx() })
        if (reserveStatus || status != null) {
            Text(status ?: "", style = PosType.Caption, color = if (error) Pos.Danger else Pos.Muted, textAlign = TextAlign.Center,
                maxLines = 1, modifier = Modifier.fillMaxWidth().height(16.dp))
        }
        val rows = listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf("clear", "0", "⌫"))
        Column(verticalArrangement = Arrangement.spacedBy(Pos.Space2)) {
            rows.forEach { row ->
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Pos.Space2)) {
                    row.forEach { key ->
                        run {
                            // Clear di kiri mengimbangi hapus di kanan (permintaan owner 5 Okt 2026).
                            val enabled = if (key == "⌫" || key == "clear") pin.isNotEmpty() else (pin.length < 6 || rejected)
                            val interaction = remember { MutableInteractionSource() }
                            Box(
                                modifier = Modifier
                                    .weight(1f)
                                    .height(56.dp)
                                    .pressable(interaction)
                                    .clip(RoundedCornerShape(Pos.Radius))
                                    .background(Pos.SurfaceMuted)
                                    .border(1.dp, Pos.Line, RoundedCornerShape(Pos.Radius))
                                    .clickable(enabled = enabled, interactionSource = interaction, indication = null, onClickLabel = when (key) { "⌫" -> "Delete"; "clear" -> "Clear PIN"; else -> key }) { press(key) },
                                contentAlignment = Alignment.Center,
                            ) {
                                if (key == "⌫") Icon(Icons.Outlined.Backspace, contentDescription = "Delete", tint = if (enabled) Pos.Text else Pos.Subtle, modifier = Modifier.size(22.dp))
                                else if (key == "clear") Text("Clear", style = PosType.Label, color = if (enabled) Pos.Text else Pos.Subtle)
                                else Text(key, style = PosType.AmountSmall.copy(fontWeight = PosType.Body.fontWeight), color = if (enabled) Pos.Ink else Pos.Subtle)
                            }
                        }
                    }
                }
            }
        }
    } }
}

// Dialog PIN satu bentuk di tablet, sama dengan dialog PIN dashboard (permintaan owner
// 5 Okt 2026): ikon gembok, judul, satu baris, titik, status, papan angka. Tutup hanya
// lewat X; angka keenam langsung diproses, jadi tidak ada tombol Cancel/Unlock.
@Composable
fun PinDialog(
    title: String,
    subtitle: String,
    onDismiss: () -> Unit,
    onComplete: (String) -> Unit,
    error: String? = null,
    busy: Boolean = false,
    onEdit: () -> Unit = {},
) {
    var pin by remember { mutableStateOf("") }
    PosDialog(onDismiss = onDismiss, width = 400.dp) {
        Box(Modifier.fillMaxWidth()) {
            Column(Modifier.fillMaxWidth().padding(Pos.Space6), horizontalAlignment = Alignment.CenterHorizontally) {
                Box(Modifier.size(48.dp).clip(CircleShape).background(Pos.PrimarySoft), contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.Lock, contentDescription = null, tint = Pos.Primary, modifier = Modifier.size(22.dp))
                }
                Spacer(Modifier.height(Pos.Space3))
                Text(title, style = PosType.Heading, color = Pos.Ink, textAlign = TextAlign.Center)
                Text(subtitle, style = PosType.BodySmall, color = Pos.Muted, textAlign = TextAlign.Center)
                Spacer(Modifier.height(Pos.Space3))
                PinPad(pin, { pin = it; onEdit() }, error = error != null, onComplete = onComplete,
                    status = error ?: if (busy) "Checking…" else null, reserveStatus = true)
            }
            PosIconButton(Icons.Outlined.Close, "Close", onDismiss, outlined = false, modifier = Modifier.align(Alignment.TopEnd).padding(top = Pos.Space4, end = Pos.Space4))
        }
    }
}

@Composable
fun PinDots(pin: String, error: Boolean, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier.semantics { contentDescription = "PIN, ${pin.length} of 6 digits entered" },
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        repeat(6) { index ->
            val filled = index < pin.length
            val tint = if (error && pin.length == 6) Pos.Danger else Pos.Ink
            Box(
                Modifier
                    .size(14.dp)
                    .clip(CircleShape)
                    .background(if (filled) tint else Color.Transparent)
                    .border(1.5.dp, if (filled) tint else if (error) Pos.Danger else Pos.Muted, CircleShape),
            )
        }
    }
}

fun appendDigits(current: String, key: String, maxDigits: Int = 10): String =
    (current + key).trimStart('0').take(maxDigits)

// Dialog standar: panel putih di tengah, sudut 20, latar gelap tipis.
// Tinggi mengikuti isi sampai 88% layar; ketuk di luar untuk menutup.
@Composable
fun PosDialog(onDismiss: () -> Unit, width: Dp = 560.dp, fixedHeight: Dp? = null, dismissOnOutside: Boolean = true, content: @Composable ColumnScope.() -> Unit) {
    if (LocalCompact.current) {
        PosSheet(onDismiss, fixedHeight != null, dismissOnOutside, content)
        return
    }
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

/** Jarak tepi isi dialog: 20 dp di sheet ponsel, 24 dp di dialog tablet (sejajar DialogHeader). */
@Composable
fun dialogInset(): Dp = if (LocalCompact.current) Pos.Space5 else Pos.Space6

// Di ponsel setiap dialog menjadi bottom sheet Material bawaan: isi yang sama
// (DialogHeader, DialogBody, DialogFooter), digeser naik oleh keyboard. Dialog
// bertinggi tetap (pembayaran, daftar bill) memakai hampir seluruh layar.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PosSheet(onDismiss: () -> Unit, tall: Boolean, dismissible: Boolean, content: @Composable ColumnScope.() -> Unit) {
    val screenFocus = LocalFocusManager.current
    LaunchedEffect(Unit) { screenFocus.clearFocus() }
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { dismissible || it != SheetValue.Hidden })
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        sheetGesturesEnabled = dismissible,
        properties = ModalBottomSheetProperties(shouldDismissOnBackPress = dismissible),
        containerColor = Pos.Surface,
        shape = RoundedCornerShape(topStart = Pos.RadiusSheet, topEnd = Pos.RadiusSheet),
        dragHandle = { androidx.compose.material3.BottomSheetDefaults.DragHandle(color = Pos.Line) },
    ) {
        Column(modifier = Modifier.fillMaxWidth().then(if (tall) Modifier.fillMaxHeight(0.94f) else Modifier).imePadding(), content = content)
    }
}

// Isi dialog di antara DialogHeader dan DialogFooter. Bagian ini yang
// menyusut dan bisa digulir saat keyboard terbuka; kolom yang difokuskan
// digulir masuk ke layar, sementara judul dan tombol tetap terlihat.
@Composable
fun ColumnScope.DialogBody(spacing: Dp = Pos.Space4, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier.weight(1f, fill = false).fadingVerticalScroll().padding(if (LocalCompact.current) Pos.Space5 else Pos.Space6),
        verticalArrangement = Arrangement.spacedBy(spacing),
        content = content,
    )
}

@Composable
fun DialogHeader(title: String, subtitle: String? = null, onClose: (() -> Unit)?, leading: (@Composable () -> Unit)? = null) {
    // Atas, kanan, dan bawah sama 16 dp: tombol tutup berjarak sama dari sudut
    // dialog, seperti panel di dashboard dan Studio.
    val compact = LocalCompact.current
    Row(
        modifier = Modifier.fillMaxWidth().padding(start = if (compact) Pos.Space5 else Pos.Space6, end = Pos.Space4, top = if (compact) 0.dp else Pos.Space4, bottom = Pos.Space4),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Pos.Space3),
    ) {
        leading?.invoke()
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = if (compact) PosType.Heading else PosType.Title, color = Pos.Ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (subtitle != null) Text(subtitle, style = PosType.BodySmall, color = Pos.Muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        if (onClose != null) PosIconButton(Icons.Outlined.Close, "Close", onClose, outlined = false)
    }
    HorizontalLine()
}

@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun DialogFooter(hint: String? = null, hintTone: Tone = Tone.Neutral, content: @Composable RowScope.() -> Unit) {
    HorizontalLine()
    if (LocalCompact.current) {
        // Ponsel: keterangan di atas, tombol mengalir ke baris berikutnya bila tidak muat.
        Column(modifier = Modifier.fillMaxWidth().padding(horizontal = Pos.Space5, vertical = Pos.Space4).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(Pos.Space3)) {
            if (hint != null) Text(hint, style = PosType.Caption, color = if (hintTone == Tone.Neutral) Pos.Muted else hintTone.foreground())
            androidx.compose.foundation.layout.FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Pos.Space2, Alignment.End),
                verticalArrangement = Arrangement.spacedBy(Pos.Space2),
            ) { androidx.compose.runtime.CompositionLocalProvider(LocalFooterScope provides this) { content() } }
        }
        return
    }
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
    if (LocalCompact.current) {
        AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text(title, style = PosType.Title, color = Pos.Ink) },
            text = { Text(body, style = PosType.Body, color = Pos.Muted) },
            confirmButton = { TextButton(onClick = { onDismiss(); onConfirm() }, colors = ButtonDefaults.textButtonColors(contentColor = if (danger) Pos.Danger else Pos.PrimaryPressed)) { Text(confirmLabel, style = PosType.Label) } },
            dismissButton = { TextButton(onClick = onDismiss, colors = ButtonDefaults.textButtonColors(contentColor = Pos.Text)) { Text(cancelLabel, style = PosType.Label) } },
            containerColor = Pos.Surface,
            shape = RoundedCornerShape(Pos.RadiusSheet),
        )
        return
    }
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
    val compact = LocalCompact.current
    val haptics = LocalHapticFeedback.current
    var visible by remember { mutableStateOf<ToastMessage?>(null) }
    LaunchedEffect(toast?.id) {
        if (toast == null) return@LaunchedEffect
        visible = toast
        // Gagal terasa berbeda dari berhasil, tanpa perlu melihat layar.
        if (toast.tone == Tone.Danger) haptics.performHapticFeedback(HapticFeedbackType.Reject)
        delay(if (toast.tone == Tone.Danger) 4_500 else 2_600)
        visible = null
        onDismiss()
    }
    AnimatedVisibility(
        visible = visible != null,
        enter = slideInVertically { -it } + fadeIn(),
        exit = slideOutVertically { -it } + fadeOut(),
        modifier = Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(top = if (compact) Pos.Space2 else Pos.Space4, start = Pos.Space4, end = Pos.Space4),
    ) {
        val message = visible ?: toast ?: return@AnimatedVisibility
        // Kapsul selebar isinya (permintaan owner 14 Okt 2026): pesan pendek tetap ringkas di
        // tengah, pesan panjang membungkus sampai 3 baris dalam lebar maksimum. Sama dengan
        // toast dashboard. Ketuk untuk menutup.
        Row(
            modifier = Modifier
                .widthIn(max = if (compact) 480.dp else 520.dp)
                .shadow(12.dp, RoundedCornerShape(Pos.RadiusCard), ambientColor = Color.Black.copy(alpha = 0.10f), spotColor = Color.Black.copy(alpha = 0.18f))
                .clip(RoundedCornerShape(Pos.RadiusCard))
                .background(if (message.tone == Tone.Danger) Pos.Danger else Pos.Ink)
                .clickable(onClickLabel = "Dismiss") { visible = null; onDismiss() }
                .padding(start = Pos.Space3, end = Pos.Space4, top = 10.dp, bottom = 10.dp),
            // Ikon sejajar baris pertama (ikon 18 = tinggi baris 18), sama dengan toast dashboard:
            // satu baris tetap di tengah, pesan panjang tidak membuat ikon melayang di tengah.
            verticalAlignment = Alignment.Top,
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
                    Tone.Danger -> Color.White
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
    Text(text.uppercase(), style = PosType.Eyebrow, color = Pos.Muted, modifier = modifier)
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
            // Form dialog tetap ringkas: baris titik PIN, papan angkanya di dialog kecil
            // yang menutup sendiri sesudah angka keenam.
            var entering by remember { mutableStateOf(false) }
            val pinShape = RoundedCornerShape(Pos.Radius)
            // Label dan jarak sama dengan PosTextField, supaya sejajar dengan kolom Reason di atasnya.
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Manager PIN", style = PosType.Caption.copy(fontWeight = PosType.Label.fontWeight), color = Pos.Text)
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(56.dp)
                        .clip(pinShape)
                        .border(1.dp, if (error != null) Pos.Danger else Pos.Line, pinShape)
                        .clickable(onClickLabel = "Enter manager PIN") { entering = true }
                        .padding(horizontal = Pos.Space4),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    PinDots(password, error != null)
                    Spacer(Modifier.weight(1f))
                    Text(if (password.isEmpty()) "Enter PIN" else "Change", style = PosType.Label, color = Pos.Primary)
                }
                Text("Approved by a manager, logged with their name.", style = PosType.Caption, color = Pos.Muted)
            }
            if (entering) {
                PinDialog("Manager PIN", "A manager or owner approves this.", onDismiss = { entering = false },
                    onComplete = { onPassword(it); entering = false })
            }
        } else {
            Text("Recorded in the audit log with your name.", style = PosType.Caption, color = Pos.Muted)
        }
    }
}
