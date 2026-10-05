package id.mangalli.pos.offline

// QRIS toko dengan nominal otomatis, salinan server/qris.ts (ubah keduanya
// bersama). Tag 01 menjadi "12" (dinamis), tag 54 berisi nominal, CRC16
// CCITT-FALSE di tag 63. Dana masuk ke merchant pemilik QRIS; kasir tetap
// mengonfirmasi setelah pembayaran terlihat, seperti mesin EDC tanpa notifikasi.
object Qris {
    private data class Field(val tag: String, val value: String)

    fun crc16(input: String): String {
        var crc = 0xFFFF
        for (byte in input.toByteArray(Charsets.UTF_8)) {
            crc = crc xor ((byte.toInt() and 0xFF) shl 8)
            repeat(8) { crc = if (crc and 0x8000 != 0) ((crc shl 1) xor 0x1021) and 0xFFFF else (crc shl 1) and 0xFFFF }
        }
        return crc.toString(16).uppercase().padStart(4, '0')
    }

    private fun parse(payload: String): List<Field>? {
        val fields = mutableListOf<Field>()
        var index = 0
        while (index < payload.length) {
            if (index + 4 > payload.length) return null
            val tag = payload.substring(index, index + 2)
            val length = payload.substring(index + 2, index + 4).toIntOrNull() ?: return null
            if (!tag.all(Char::isDigit) || index + 4 + length > payload.length) return null
            fields += Field(tag, payload.substring(index + 4, index + 4 + length))
            index += 4 + length
        }
        return fields
    }

    private fun valid(payload: String): List<Field>? {
        if (!payload.startsWith("000201")) return null
        val fields = parse(payload) ?: return null
        val crc = fields.lastOrNull()?.takeIf { it.tag == "63" && it.value.length == 4 } ?: return null
        if (!crc16(payload.dropLast(4)).equals(crc.value, ignoreCase = true)) return null
        if (fields.firstOrNull { it.tag == "53" }?.value != "360" || fields.none { it.tag == "59" }) return null
        return fields
    }

    fun merchantName(payload: String?): String? = payload?.trim()?.let(::valid)?.firstOrNull { it.tag == "59" }?.value

    /** Payload QRIS dinamis untuk [amount] rupiah, atau null bila QRIS toko tidak sah. */
    fun dynamic(staticPayload: String?, amount: Long): String? {
        if (amount < 1 || amount > 99_999_999) return null
        val fields = staticPayload?.trim()?.let(::valid)?.filter { it.tag != "63" && it.tag != "54" }?.toMutableList() ?: return null
        val typeIndex = fields.indexOfFirst { it.tag == "01" }
        if (typeIndex >= 0) fields[typeIndex] = Field("01", "12") else fields.add(1, Field("01", "12"))
        val insertAt = fields.indexOfFirst { it.tag.toInt() > 54 }.let { if (it == -1) fields.size else it }
        fields.add(insertAt, Field("54", amount.toString()))
        val body = fields.joinToString("") { "${it.tag}${it.value.length.toString().padStart(2, '0')}${it.value}" } + "6304"
        return body + crc16(body)
    }
}
