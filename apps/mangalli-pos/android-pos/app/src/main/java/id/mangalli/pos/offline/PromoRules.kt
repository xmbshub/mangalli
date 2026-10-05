package id.mangalli.pos.offline

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import kotlin.math.min
import kotlin.math.roundToLong

// Aturan promo Mangalli versi tablet (offline). Sumber aturan:
// apps/mangalli-pos/server/promotion-rules.ts; ubah bersama.
data class Promo(
    val id: Long,
    val name: String,
    val kind: String,
    val value: Double,
    val maxDiscount: Double?,
    val minSubtotal: Double,
    val scope: String,
    val categoryNames: Set<String>,
    val productIds: Set<String>,
    val days: Set<Int>,
    val startTime: String?,
    val endTime: String?,
    // Kupon: hanya berlaku bila kasir mengetik kodenya; tanggal berlaku dan
    // sisa pemakaian dari sinkron terakhir (pemakaian lintas kanal dihitung server).
    val code: String? = null,
    val startsOn: String? = null,
    val endsOn: String? = null,
    val maxUses: Int? = null,
    val used: Int = 0,
)

data class PromoLine(val productId: String?, val categoryName: String?, val lineTotal: Double)

// Diskon yang dipilih kasir: promo dari dashboard atau diskon manual
// (persen/rupiah) yang wajib beralasan dan disetujui manager bila kasir.
data class DiscountSpec(
    val promoId: Long? = null,
    val label: String,
    val kind: String = "percent",
    val value: Double = 0.0,
    val reason: String? = null,
    val byUserId: Long? = null,
    val approvedByUserId: Long? = null,
    val eventId: String? = null,
) {
    val manual: Boolean get() = promoId == null

    fun toJson(): String = JSONObject()
        .put("promoId", promoId ?: JSONObject.NULL).put("label", label).put("kind", kind).put("value", value)
        .put("reason", reason ?: JSONObject.NULL).put("byUserId", byUserId ?: JSONObject.NULL)
        .put("approvedByUserId", approvedByUserId ?: JSONObject.NULL).put("eventId", eventId ?: JSONObject.NULL)
        .toString()

    companion object {
        fun fromJson(raw: String?): DiscountSpec? = raw?.takeIf { it.isNotBlank() }?.let { text ->
            runCatching {
                val json = JSONObject(text)
                DiscountSpec(
                    promoId = json.optLong("promoId").takeIf { it > 0 },
                    label = json.getString("label"),
                    kind = json.optString("kind", "percent"),
                    value = json.optDouble("value", 0.0),
                    reason = json.optString("reason").takeIf { it.isNotBlank() && it != "null" },
                    byUserId = json.optLong("byUserId").takeIf { it > 0 },
                    approvedByUserId = json.optLong("approvedByUserId").takeIf { it > 0 },
                    eventId = json.optString("eventId").takeIf { it.isNotBlank() && it != "null" },
                )
            }.getOrNull()
        }
    }
}

object PromoRules {
    fun parse(raw: String?): List<Promo> = runCatching {
        val rows = JSONArray(raw ?: "[]")
        (0 until rows.length()).map { index ->
            val row = rows.getJSONObject(index)
            fun strings(key: String) = row.optJSONArray(key)?.let { list -> (0 until list.length()).map { list.getString(it) }.toSet() } ?: emptySet()
            Promo(
                id = row.getLong("id"),
                name = row.getString("name"),
                kind = row.getString("kind"),
                value = row.getDouble("value"),
                maxDiscount = row.optDouble("maxDiscount").takeIf { !it.isNaN() && it > 0 },
                minSubtotal = row.optDouble("minSubtotal", 0.0),
                scope = row.optString("scope", "order"),
                categoryNames = strings("categoryNames"),
                productIds = strings("productIds"),
                days = row.optJSONArray("days")?.let { list -> (0 until list.length()).map { list.getInt(it) }.toSet() } ?: (1..7).toSet(),
                startTime = row.optString("startTime").takeIf { it.length == 5 },
                endTime = row.optString("endTime").takeIf { it.length == 5 },
                code = row.optString("code").takeIf { it.isNotBlank() && it != "null" },
                startsOn = row.optString("startsOn").takeIf { it.length == 10 },
                endsOn = row.optString("endsOn").takeIf { it.length == 10 },
                maxUses = row.optInt("maxUses", 0).takeIf { it > 0 },
                used = row.optInt("used", 0),
            )
        }
    }.getOrDefault(emptyList())

    private fun minutes(value: String) = value.substring(0, 2).toInt() * 60 + value.substring(3, 5).toInt()

    // Jendela jam boleh melewati tengah malam; hari mengikuti jam mulai.
    fun isLive(promo: Promo, nowMillis: Long, zone: ZoneId): Boolean {
        val local = Instant.ofEpochMilli(nowMillis).atZone(zone)
        val today = local.toLocalDate().toString()
        if ((promo.startsOn != null && today < promo.startsOn) || (promo.endsOn != null && today > promo.endsOn)) return false
        if (promo.maxUses != null && promo.used >= promo.maxUses) return false
        val weekday = local.dayOfWeek.value
        val now = local.hour * 60 + local.minute
        val start = promo.startTime?.let(::minutes)
        val end = promo.endTime?.let(::minutes)
        if (start == null || end == null) return weekday in promo.days
        if (start <= end) return weekday in promo.days && now >= start && now < end
        val yesterday = if (weekday == 1) 7 else weekday - 1
        return (weekday in promo.days && now >= start) || (yesterday in promo.days && now < end)
    }

    fun discount(promo: Promo, lines: List<PromoLine>): Double {
        val subtotal = lines.sumOf { it.lineTotal }
        if (subtotal <= 0 || subtotal < promo.minSubtotal) return 0.0
        val base = when (promo.scope) {
            "category" -> lines.filter { it.categoryName != null && it.categoryName in promo.categoryNames }.sumOf { it.lineTotal }
            "product" -> lines.filter { it.productId != null && it.productId in promo.productIds }.sumOf { it.lineTotal }
            else -> subtotal
        }
        if (base <= 0) return 0.0
        val raw = if (promo.kind == "percent") base * promo.value / 100 else promo.value
        val capped = if (promo.kind == "percent" && promo.maxDiscount != null) min(raw, promo.maxDiscount) else raw
        return min(capped, base).roundToLong().toDouble()
    }

    // Diskon manual: persen dari subtotal atau nominal rupiah, tidak melebihi subtotal.
    fun manualDiscount(spec: DiscountSpec, subtotal: Double): Double {
        if (subtotal <= 0) return 0.0
        val raw = if (spec.kind == "percent") subtotal * spec.value.coerceIn(0.0, 100.0) / 100 else spec.value
        return min(raw, subtotal).coerceAtLeast(0.0).roundToLong().toDouble()
    }

    fun normalizeCode(raw: String): String? = raw.trim().uppercase().replace(Regex("\\s+"), "").takeIf { Regex("^[A-Z0-9_-]{3,24}$").matches(it) }

    // Alasan kupon tidak bisa dipakai (null = bisa), dengan pesan untuk kasir.
    fun couponProblem(promo: Promo?, lines: List<PromoLine>, nowMillis: Long, zone: ZoneId): String? {
        if (promo?.code == null) return "This coupon code isn't valid on this tablet."
        val today = Instant.ofEpochMilli(nowMillis).atZone(zone).toLocalDate().toString()
        if (promo.startsOn != null && today < promo.startsOn) return "This coupon starts on ${promo.startsOn}."
        if (promo.endsOn != null && today > promo.endsOn) return "This coupon has expired."
        if (promo.maxUses != null && promo.used >= promo.maxUses) return "This coupon has been fully used."
        if (!isLive(promo, nowMillis, zone)) return "This coupon can't be used at this time."
        if (lines.sumOf { it.lineTotal } < promo.minSubtotal) return "Spend at least Rp ${"%,.0f".format(promo.minSubtotal).replace(',', '.')} to use this coupon."
        if (discount(promo, lines) <= 0) return "This coupon doesn't apply to the items in this order."
        return null
    }

    fun amountFor(spec: DiscountSpec?, promos: List<Promo>, lines: List<PromoLine>): Double {
        if (spec == null) return 0.0
        if (spec.manual) return manualDiscount(spec, lines.sumOf { it.lineTotal })
        return promos.firstOrNull { it.id == spec.promoId }?.let { discount(it, lines) } ?: 0.0
    }
}
