package id.mangalli.pos.support

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// Laporan masalah tablet. Crash ditulis ke berkas saat terjadi (aplikasi
// sedang mati, jadi tidak bisa mengirim) lalu dikirim setelah aplikasi dibuka
// dan online. Galat terakhir yang dilihat kasir ikut sebagai konteks laporan.
class ProblemReporter(context: Context) {
    private val crashFile = File(context.filesDir, "pending-crash.json")
    private val recent = ArrayDeque<String>()

    fun install() {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching {
                crashFile.writeText(
                    JSONObject()
                        .put("title", "App crashed: ${error.javaClass.simpleName}${error.message?.let { ": $it" } ?: ""}".take(160))
                        .put("stack", error.stackTraceToString().take(1900))
                        .put("fingerprint", fingerprint(error))
                        .put("at", stamp())
                        .toString()
                )
            }
            previous?.uncaughtException(thread, error)
        }
    }

    fun noteError(message: String) = synchronized(recent) {
        recent.addLast("${stamp()} ${message.take(160)}")
        while (recent.size > 8) recent.removeFirst()
    }

    fun recentErrors(): String = synchronized(recent) { recent.joinToString("\n") }

    fun pendingCrash(): JSONObject? = if (crashFile.exists()) runCatching { JSONObject(crashFile.readText()) }.getOrNull() else null

    fun clearCrash() {
        crashFile.delete()
    }

    private fun stamp() = SimpleDateFormat("dd MMM HH:mm:ss", Locale.US).format(Date())

    // Crash yang sama (kelas + empat frame teratas) digabung di dashboard.
    private fun fingerprint(error: Throwable): String {
        val key = (listOf(error.javaClass.name) + error.stackTrace.take(4).map { "${it.className}.${it.methodName}" }).joinToString("|")
        return "crash:" + MessageDigest.getInstance("SHA-1").digest(key.toByteArray()).joinToString("") { "%02x".format(it) }.take(16)
    }
}
