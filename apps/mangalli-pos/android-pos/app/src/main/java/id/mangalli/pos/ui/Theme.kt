package id.mangalli.pos.ui

import androidx.compose.animation.core.AnimationSpec
import androidx.compose.animation.core.tween
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

// Design system tablet Mangalli. Satu sumber untuk warna, sudut, jarak, dan
// huruf; sama dengan dashboard dan menu digital (aksen oranye, abu zinc,
// kartu 16, kontrol 12, bobot paling tebal Medium). Semua layar memakai
// token ini, tidak ada warna atau ukuran lepas.
// Kredit pembuat yang sama di tablet, dashboard, menu digital, dan struk.
const val BRAND_CREDIT = "Developed by 1garis Studio"

object Pos {
    val Primary = Color(0xFFEA580C)
    val PrimaryPressed = Color(0xFFC2410C)
    val PrimarySoft = Color(0xFFFFF7ED)
    val PrimarySoftStrong = Color(0xFFFFEDD5)
    val PrimaryLine = Color(0xFFFED7AA)

    // Pilihan (menu samping, chip, segmen) pindah cepat: animasi warna yang
    // lambat membuat dua item tampak terpilih sekaligus seperti bayangan.
    val QuickColor: AnimationSpec<Color> = tween(80)

    val Ink = Color(0xFF18181B)
    val Text = Color(0xFF3F3F46)
    val Muted = Color(0xFF71717A)
    val Subtle = Color(0xFFA1A1AA)
    val Line = Color(0xFFE4E4E7)
    val LineSoft = Color(0xFFF4F4F5)
    val Canvas = Color(0xFFF4F4F5)
    val Surface = Color.White
    val SurfaceMuted = Color(0xFFFAFAFA)
    val Scrim = Color(0x6618181B)

    val Success = Color(0xFF15803D)
    val SuccessSoft = Color(0xFFECFDF5)
    val Warning = Color(0xFFB45309)
    val WarningSoft = Color(0xFFFFFBEB)
    val Danger = Color(0xFFDC2626)
    val DangerSoft = Color(0xFFFEF2F2)
    val Info = Color(0xFF1D4ED8)
    val InfoSoft = Color(0xFFEFF6FF)

    // Sudut
    val RadiusSmall = 8.dp
    val Radius = 12.dp
    val RadiusCard = 16.dp
    val RadiusSheet = 20.dp

    // Jarak (kelipatan 4)
    val Space1 = 4.dp
    val Space2 = 8.dp
    val Space3 = 12.dp
    val Space4 = 16.dp
    val Space5 = 20.dp
    val Space6 = 24.dp
    val Space8 = 32.dp

    // Tinggi kontrol; target sentuh minimal 44dp di tablet kasir.
    val ControlLarge = 52.dp
    val Control = 44.dp
    val ControlSmall = 36.dp
    // Tinggi kolom input Material; kontrol yang sebaris dengan input ikut tinggi ini.
    val Field = 56.dp
}

// Mode ponsel (permintaan owner 14 Okt 2026): layar dengan sisi terpendek < 600 dp.
// Di ponsel komponen dasar memakai komponen Material 3 bawaan Android (Button,
// FilterChip, SegmentedButton, ModalBottomSheet, AlertDialog, Snackbar) dan
// kerangkanya TopAppBar + NavigationBar; tablet tetap seperti sebelumnya.
// Warna, sudut, dan huruf tetap dari token yang sama.
val LocalCompact = staticCompositionLocalOf { false }

/** "phone" atau "tablet" untuk teks yang menyebut perangkat ini. */
@Composable
fun deviceNoun(): String = if (LocalCompact.current) "phone" else "tablet"

enum class Tone { Neutral, Primary, Success, Warning, Danger, Info }

fun Tone.foreground(): Color = when (this) {
    Tone.Neutral -> Pos.Text
    Tone.Primary -> Pos.PrimaryPressed
    Tone.Success -> Pos.Success
    Tone.Warning -> Pos.Warning
    Tone.Danger -> Pos.Danger
    Tone.Info -> Pos.Info
}

fun Tone.background(): Color = when (this) {
    Tone.Neutral -> Pos.LineSoft
    Tone.Primary -> Pos.PrimarySoftStrong
    Tone.Success -> Pos.SuccessSoft
    Tone.Warning -> Pos.WarningSoft
    Tone.Danger -> Pos.DangerSoft
    Tone.Info -> Pos.InfoSoft
}

// Skala huruf: angka besar 32/22, judul 20/16, isi 14/13, keterangan 12/11.
// Bobot maksimal Medium (permintaan owner 25 Sep 2026: font Android jangan
// berat). Hierarki dibangun dari ukuran, warna (Ink vs Muted), jarak baris, dan
// tracking yang ikut ukuran (audit apple-design 15 Okt 2026): huruf besar
// dirapatkan, huruf kecil sedikit direnggangkan, label kapital lebih lebar.
object PosType {
    private val family = FontFamily.SansSerif
    val Amount = TextStyle(fontFamily = family, fontSize = 32.sp, lineHeight = 38.sp, fontWeight = FontWeight.Medium, letterSpacing = (-0.02).em)
    val AmountSmall = TextStyle(fontFamily = family, fontSize = 22.sp, lineHeight = 28.sp, fontWeight = FontWeight.Medium, letterSpacing = (-0.01).em)
    val Title = TextStyle(fontFamily = family, fontSize = 20.sp, lineHeight = 26.sp, fontWeight = FontWeight.Medium, letterSpacing = (-0.01).em)
    val Heading = TextStyle(fontFamily = family, fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.Medium, letterSpacing = (-0.005).em)
    val Label = TextStyle(fontFamily = family, fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium)
    val Body = TextStyle(fontFamily = family, fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Normal)
    val BodySmall = TextStyle(fontFamily = family, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Normal)
    val Caption = TextStyle(fontFamily = family, fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Normal, letterSpacing = 0.01.em)
    val Micro = TextStyle(fontFamily = family, fontSize = 11.sp, lineHeight = 14.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.02.em)
    // Label kecil berhuruf kapital (CASH RECEIVED, nama kelompok): kapital butuh jarak lebih lebar.
    val Eyebrow = Micro.copy(letterSpacing = 0.06.em)
    // Angka di badge 16 dp: baris dipangkas supaya angka tepat di tengah lingkaran.
    val Badge = TextStyle(fontFamily = family, fontSize = 10.sp, lineHeight = 10.sp, fontWeight = FontWeight.Medium, lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.Both))
}

@Composable
fun MangalliTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Pos.Primary,
            onPrimary = Color.White,
            primaryContainer = Pos.PrimarySoftStrong,
            onPrimaryContainer = Pos.PrimaryPressed,
            secondary = Pos.Primary,
            secondaryContainer = Pos.PrimarySoftStrong,
            onSecondaryContainer = Pos.PrimaryPressed,
            surface = Pos.Surface,
            surfaceTint = Pos.Surface,
            surfaceContainerLowest = Pos.Surface,
            surfaceContainerLow = Pos.Surface,
            surfaceContainer = Pos.Surface,
            surfaceContainerHigh = Pos.Surface,
            surfaceContainerHighest = Pos.LineSoft,
            inverseSurface = Pos.Ink,
            inverseOnSurface = Color.White,
            inversePrimary = Pos.PrimaryLine,
            background = Pos.Canvas,
            onSurface = Pos.Ink,
            onSurfaceVariant = Pos.Muted,
            onBackground = Pos.Ink,
            outline = Pos.Line,
            outlineVariant = Pos.Line,
            error = Pos.Danger,
        ),
        typography = Typography(
            titleLarge = PosType.Title,
            titleMedium = PosType.Heading,
            titleSmall = PosType.Label,
            bodyLarge = PosType.Body,
            bodyMedium = PosType.BodySmall,
            bodySmall = PosType.Caption,
            labelLarge = PosType.Label,
            labelMedium = PosType.Caption.copy(fontWeight = FontWeight.Medium),
            labelSmall = PosType.Micro,
        ),
        shapes = Shapes(
            extraSmall = RoundedCornerShape(Pos.RadiusSmall),
            small = RoundedCornerShape(Pos.RadiusSmall),
            medium = RoundedCornerShape(Pos.Radius),
            large = RoundedCornerShape(Pos.RadiusCard),
            extraLarge = RoundedCornerShape(Pos.RadiusSheet),
        ),
        content = content,
    )
}
