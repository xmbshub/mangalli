package id.mangalli.pos.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp

// Banner di atas layar kerja saat versi baru tersedia (bukan wajib).
@Composable
fun UpdateBanner(update: AppUpdateState, actions: PosActions) {
    InfoBanner(
        "Mangalli ${update.versionName} is ready.",
        tone = Tone.Primary,
        modifier = Modifier.padding(start = Pos.Space4, end = Pos.Space4, top = Pos.Space4),
    ) {
        PosButton("What's new", onClick = actions::openUpdate, size = ButtonSize.Small)
    }
}

// Catatan rilis dan tombol update. Versi wajib tidak bisa ditutup: tablet
// tetap aman (data tersimpan), tetapi harus diperbarui untuk lanjut bekerja.
@Composable
fun UpdateDialog(update: AppUpdateState, actions: PosActions) {
    val downloading = update.progress != null
    val close = { if (!update.required && !downloading) actions.dismissUpdate() }
    PosDialog(onDismiss = close, width = 520.dp, dismissOnOutside = !update.required && !downloading) {
        DialogHeader(
            title = "Update to Mangalli ${update.versionName}",
            subtitle = if (update.required) "Required to keep using the tablet." else "What's new in this version",
            onClose = if (update.required || downloading) null else close,
        )
        DialogBody(spacing = Pos.Space2) {
            update.notes.lines().map { it.trim().removePrefix("-").removePrefix("•").trim() }.filter { it.isNotEmpty() }.forEach { line ->
                Row(horizontalArrangement = Arrangement.spacedBy(Pos.Space2)) {
                    Text("•", style = PosType.Body, color = Pos.Primary)
                    Text(line, style = PosType.Body, color = Pos.Text)
                }
            }
            if (update.progress != null) {
                Column(modifier = Modifier.padding(top = Pos.Space3), verticalArrangement = Arrangement.spacedBy(Pos.Space2)) {
                    LinearProgressIndicator(
                        progress = { update.progress },
                        modifier = Modifier.fillMaxWidth().height(6.dp).clip(CircleShape),
                        color = Pos.Primary,
                        trackColor = Pos.LineSoft,
                    )
                    Text(
                        if (update.progress >= 1f) "Opening the installer…" else "Downloading… ${(update.progress * 100).toInt()}%",
                        style = PosType.Caption,
                        color = Pos.Muted,
                    )
                }
            }
        }
        DialogFooter(
            hint = update.error ?: "Tap Install when Android asks. Your data stays.",
            hintTone = if (update.error != null) Tone.Danger else Tone.Neutral,
        ) {
            if (!update.required) PosButton("Later", onClick = close, variant = ButtonVariant.Secondary, enabled = !downloading)
            PosButton(if (update.error != null) "Try again" else "Update now", onClick = actions::startUpdate, loading = downloading)
        }
    }
}
