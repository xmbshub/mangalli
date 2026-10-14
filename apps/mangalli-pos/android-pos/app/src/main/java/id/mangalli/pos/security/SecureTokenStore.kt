package id.mangalli.pos.security

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SecureTokenStore(context: Context) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("mangalli_secure_tokens", Context.MODE_PRIVATE)

    // Setiap operasi Android KeyStore lewat IPC sistem. Kunci dan hasil dekripsi disimpan
    // di memori proses supaya nilai yang sama (token, outlet) tidak didekripsi berulang
    // kali selama aplikasi berjalan. Di disk tetap terenkripsi.
    @Volatile private var key: SecretKey? = null
    private val cache = java.util.concurrent.ConcurrentHashMap<String, String>()
    private val missing = java.util.Collections.newSetFromMap(java.util.concurrent.ConcurrentHashMap<String, Boolean>())

    fun save(key: String, value: String) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        prefs.edit()
            .putString("${key}_iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .putString(key, Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .apply()
        cache[key] = value
        missing.remove(key)
    }

    fun read(key: String): String? {
        cache[key]?.let { return it }
        if (key in missing) return null
        val iv = prefs.getString("${key}_iv", null)
        val encrypted = prefs.getString(key, null)
        if (iv == null || encrypted == null) { missing.add(key); return null }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(
            Cipher.DECRYPT_MODE,
            secretKey(),
            GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)),
        )

        return String(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)), Charsets.UTF_8).also { cache[key] = it }
    }

    // Putus hubungan tablet: semua token dan data outlet dihapus.
    fun clearAll() {
        prefs.edit().clear().apply()
        cache.clear()
        missing.clear()
    }

    private fun secretKey(): SecretKey = key ?: loadKey().also { key = it }

    private fun loadKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry

        if (existing != null) {
            return existing.secretKey
        }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )

        return generator.generateKey()
    }

    companion object {
        private const val KEY_ALIAS = "mangalli_pos_tokens"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
