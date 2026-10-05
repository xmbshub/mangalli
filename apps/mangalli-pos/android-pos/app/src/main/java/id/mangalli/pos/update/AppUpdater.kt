package id.mangalli.pos.update

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

// Rilis dari GET /api/android-pos/app-update (diterbitkan scripts/publish-release.ts).
data class AppRelease(
    val versionCode: Int,
    val versionName: String,
    val notes: String,
    val url: String,
    val sha256: String,
    val size: Long,
    val minVersionCode: Int,
)

// Update dari server sendiri: unduh APK ke cache, cocokkan SHA-256 dengan rilis,
// lalu serahkan ke installer Android. Android selalu meminta kasir menekan
// Install; data Room dan login tetap ada karena APK ditandatangani kunci yang sama.
class AppUpdater(private val context: Context) {
    private val folder get() = File(context.cacheDir, "updates").apply { mkdirs() }

    fun canInstall(): Boolean = context.packageManager.canRequestPackageInstalls()

    fun download(release: AppRelease, onProgress: (Float) -> Unit): File {
        val target = File(folder, "mangalli-pos-${release.versionCode}.apk")
        folder.listFiles()?.filter { it != target }?.forEach { it.delete() }
        if (target.exists() && sha256(target) == release.sha256) return target
        val partial = File(folder, "${target.name}.part")
        val connection = (URL(release.url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 30_000
        }
        try {
            check(connection.responseCode in 200..299) { "Download failed (${connection.responseCode})." }
            val total = connection.contentLengthLong.takeIf { it > 0 } ?: release.size
            var done = 0L
            connection.inputStream.use { input ->
                partial.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        output.write(buffer, 0, read)
                        done += read
                        if (total > 0) onProgress((done.toFloat() / total).coerceIn(0f, 1f))
                    }
                }
            }
        } finally {
            connection.disconnect()
        }
        if (sha256(partial) != release.sha256) {
            partial.delete()
            error("The download was damaged. Try again.")
        }
        check(partial.renameTo(target)) { "Couldn't save the update." }
        return target
    }

    fun install(apk: File) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val sessionId = installer.createSession(params)
        installer.openSession(sessionId).use { session ->
            session.openWrite("mangalli-pos.apk", 0, apk.length()).use { output ->
                apk.inputStream().use { it.copyTo(output) }
                session.fsync(output)
            }
            val status = Intent(ACTION_INSTALL_STATUS).setPackage(context.packageName)
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
            session.commit(PendingIntent.getBroadcast(context, sessionId, status, flags).intentSender)
        }
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    companion object {
        const val ACTION_INSTALL_STATUS = "id.mangalli.pos.INSTALL_STATUS"
    }
}
