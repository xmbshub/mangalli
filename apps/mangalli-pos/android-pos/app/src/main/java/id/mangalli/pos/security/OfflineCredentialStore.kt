package id.mangalli.pos.security

import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Locale
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

// Login kasir tanpa internet. Setelah staf pertama kali masuk online di tablet
// ini, tablet menyimpan hash PBKDF2 kata sandinya (bukan kata sandi aslinya)
// beserta token sesi staf. Semua disimpan terenkripsi lewat Android Keystore.
// Masuk berikutnya diverifikasi di tablet, jadi kasir tetap bisa bekerja saat
// internet mati. Persetujuan offline memakai PIN manager/owner (approverByPin).
data class OfflineStaff(
    val userId: Long,
    val name: String,
    val email: String,
    val role: String,
    val staffToken: String,
)

class OfflineCredentialStore(private val tokens: SecureTokenStore) {
    fun remember(staff: OfflineStaff, password: String) {
        val salt = ByteArray(16).also(SecureRandom()::nextBytes)
        val entry = JSONObject()
            .put("userId", staff.userId)
            .put("name", staff.name)
            .put("email", normalize(staff.email))
            .put("role", staff.role)
            .put("staffToken", staff.staffToken)
            .put("salt", Base64.encodeToString(salt, Base64.NO_WRAP))
            .put("hash", Base64.encodeToString(derive(password, salt), Base64.NO_WRAP))
            .put("iterations", ITERATIONS)
        val others = entries().filterNot { it.optString("email") == normalize(staff.email) }
        save(others + entry)
    }

    fun verify(email: String, password: String): OfflineStaff? {
        val entry = entries().firstOrNull { it.optString("email") == normalize(email) } ?: return null
        return entry.takeIf { matches(it, password) }?.toStaff()
    }

    fun knownStaff(): List<OfflineStaff> = entries().map { it.toStaff() }

    // PIN persetujuan dari dashboard (Team). Hash "pbkdf2-sha256$iterasi$salt$hash"
    // dikirim server lewat bootstrap; PIN-nya sendiri tidak pernah disimpan.
    fun saveApprovers(json: String) = tokens.save(APPROVERS_KEY, json)

    fun hasApprovalPins(): Boolean = approvers().isNotEmpty()

    fun approverByPin(pin: String): OfflineStaff? = approvers().firstOrNull { entry ->
        val parts = entry.optString("pinHash").split('$')
        parts.size == 4 && parts[0] == "pbkdf2-sha256" && runCatching {
            val expected = Base64.decode(parts[3], Base64.NO_WRAP)
            MessageDigest.isEqual(expected, derive(pin, Base64.decode(parts[2], Base64.NO_WRAP), parts[1].toInt()))
        }.getOrDefault(false)
    }?.let { OfflineStaff(it.optLong("userId"), it.optString("name"), "", it.optString("role"), "") }

    private fun approvers(): List<JSONObject> = runCatching {
        val array = JSONArray(tokens.read(APPROVERS_KEY) ?: "[]")
        (0 until array.length()).map { array.getJSONObject(it) }.filter { it.optString("role") in setOf("owner", "manager") }
    }.getOrDefault(emptyList())

    fun forget(email: String) {
        save(entries().filterNot { it.optString("email") == normalize(email) })
    }

    private fun matches(entry: JSONObject, password: String): Boolean {
        val salt = Base64.decode(entry.optString("salt"), Base64.NO_WRAP)
        val expected = Base64.decode(entry.optString("hash"), Base64.NO_WRAP)
        val actual = derive(password, salt, entry.optInt("iterations", ITERATIONS))
        return MessageDigest.isEqual(expected, actual)
    }

    private fun JSONObject.toStaff() = OfflineStaff(
        userId = optLong("userId"),
        name = optString("name"),
        email = optString("email"),
        role = optString("role"),
        staffToken = optString("staffToken"),
    )

    private fun entries(): List<JSONObject> {
        val raw = runCatching { tokens.read(KEY) }.getOrNull() ?: return emptyList()
        return runCatching {
            val array = JSONArray(raw)
            (0 until array.length()).map { array.getJSONObject(it) }
        }.getOrElse { emptyList() }
    }

    private fun save(entries: List<JSONObject>) {
        tokens.save(KEY, JSONArray().also { array -> entries.forEach(array::put) }.toString())
    }

    private fun normalize(email: String) = email.trim().lowercase(Locale.ROOT)

    private fun derive(password: String, salt: ByteArray, iterations: Int = ITERATIONS): ByteArray {
        val spec = PBEKeySpec(password.toCharArray(), salt, iterations, 256)
        return try {
            SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
        } finally {
            spec.clearPassword()
        }
    }

    companion object {
        private const val KEY = "offline_staff_credentials"
        private const val APPROVERS_KEY = "approval_pins"
        private const val ITERATIONS = 120_000
    }
}
