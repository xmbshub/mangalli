package id.mangalli.pos.ui

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.OpenInFull
import androidx.compose.material.icons.outlined.Print
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel

// QRIS dinamis di layar pembayaran: pelanggan memindai langsung dari tablet,
// cetak tetap tersedia untuk yang lebih suka struk ala mesin EDC.
data class QrisDisplay(val payload: String, val merchant: String?)

/** QRIS dinamis untuk [total] dari QRIS toko, atau null bila belum diatur di dashboard. */
fun OutletInfo.qrisFor(total: Double): QrisDisplay? = qrisPayload?.let { static ->
    id.mangalli.pos.offline.Qris.dynamic(static, Math.round(total))?.let { QrisDisplay(it, id.mangalli.pos.offline.Qris.merchantName(static)) }
}

@Composable
fun QrImage(payload: String, size: Dp, modifier: Modifier = Modifier) {
    val bitmap = remember(payload) {
        val matrix = QRCodeWriter().encode(payload, BarcodeFormat.QR_CODE, 0, 0, mapOf(EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M, EncodeHintType.MARGIN to 2))
        val pixels = IntArray(matrix.width * matrix.height) { index -> if (matrix.get(index % matrix.width, index / matrix.width)) android.graphics.Color.BLACK else android.graphics.Color.WHITE }
        Bitmap.createBitmap(pixels, matrix.width, matrix.height, Bitmap.Config.ARGB_8888).asImageBitmap()
    }
    // Tanpa penghalusan supaya modul QR tetap tajam saat diperbesar.
    Image(bitmap, contentDescription = "QRIS code", filterQuality = FilterQuality.None, modifier = modifier.size(size))
}

@Composable
fun QrisCard(qris: QrisDisplay, total: Double, onEnlarge: () -> Unit, onPrint: (() -> Unit)?, busy: Boolean) {
    Row(
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(Pos.RadiusCard)).border(1.dp, Pos.Line, RoundedCornerShape(Pos.RadiusCard)).padding(Pos.Space4),
        horizontalArrangement = Arrangement.spacedBy(Pos.Space4),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(modifier = Modifier.clip(RoundedCornerShape(Pos.Radius)).background(Color.White)) { QrImage(qris.payload, 184.dp) }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Pos.Space2)) {
            Text("Scan to pay", style = PosType.Label, color = Pos.Muted)
            Text(formatPrice(total), style = PosType.AmountSmall, color = Pos.Ink)
            qris.merchant?.let { Text(it, style = PosType.BodySmall, color = Pos.Text) }
            Text("Any bank or e-wallet app.", style = PosType.Caption, color = Pos.Muted)
            Row(horizontalArrangement = Arrangement.spacedBy(Pos.Space2), modifier = Modifier.padding(top = Pos.Space1)) {
                PosButton("Enlarge", onClick = onEnlarge, variant = ButtonVariant.Secondary, size = ButtonSize.Small, icon = Icons.Outlined.OpenInFull)
                if (onPrint != null) PosButton("Print", onClick = onPrint, variant = ButtonVariant.Secondary, size = ButtonSize.Small, icon = Icons.Outlined.Print, enabled = !busy)
            }
        }
    }
}

// Tampilan besar untuk dihadapkan ke pelanggan.
@Composable
fun QrisFullScreen(qris: QrisDisplay, total: Double, onClose: () -> Unit) {
    PosDialog(onDismiss = onClose, width = 560.dp) {
        DialogHeader("Scan to pay", qris.merchant, onClose = onClose)
        Column(modifier = Modifier.fillMaxWidth().padding(Pos.Space6), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Pos.Space3)) {
            Text(formatPrice(total), style = PosType.Amount, color = Pos.Ink)
            QrImage(qris.payload, 380.dp)
            Text("Scan with any bank or e-wallet app.", style = PosType.BodySmall, color = Pos.Muted, textAlign = TextAlign.Center)
        }
    }
}
