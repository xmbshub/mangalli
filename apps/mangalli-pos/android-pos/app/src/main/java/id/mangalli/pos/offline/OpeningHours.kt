package id.mangalli.pos.offline

import org.json.JSONArray
import java.time.Instant
import java.time.ZoneId

// Jam buka outlet dari dashboard (Outlet > Opening hours), salinan
// server/opening-hours.ts (openingStatus + minutesSinceClose + shiftOverdue).
// Tablet hanya memakainya untuk pengingat shift yang lupa ditutup; penjualan
// kasir tidak pernah dikunci oleh jam buka. Ubah keduanya bersama, kasus ujinya sama.
data class OpeningHour(val key: String, val isOpen: Boolean, val openTime: String?, val closeTime: String?)

object OpeningHours {
    const val SHIFT_OVERDUE_MINUTES = 120
    private val weekdays = listOf("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")

    fun parse(json: String?): List<OpeningHour> = runCatching {
        val rows = JSONArray(json ?: "[]")
        (0 until rows.length()).map { index ->
            val row = rows.getJSONObject(index)
            OpeningHour(row.optString("key"), row.optBoolean("is_open"), row.optString("open_time").ifBlank { null }, row.optString("close_time").ifBlank { null })
        }
    }.getOrDefault(emptyList())

    private fun minutes(value: String) = value.take(2).toInt() * 60 + value.substring(3, 5).toInt()

    private data class Window(val start: Int, val end: Int)

    private fun window(hour: OpeningHour?): Window? =
        if (hour?.isOpen == true && hour.openTime != null && hour.closeTime != null) Window(minutes(hour.openTime), minutes(hour.closeTime)) else null

    private fun day(hours: List<OpeningHour>, weekday: Int, offset: Int) = hours.firstOrNull { it.key == weekdays[(weekday - 1 + offset + 14) % 7] }

    fun isOpen(hours: List<OpeningHour>, nowMillis: Long, zone: ZoneId): Boolean {
        if (hours.isEmpty()) return true
        val local = Instant.ofEpochMilli(nowMillis).atZone(zone)
        val weekday = local.dayOfWeek.value
        val now = local.hour * 60 + local.minute
        val yesterday = window(day(hours, weekday, -1))
        if (yesterday != null && yesterday.end < yesterday.start && now < yesterday.end) return true
        val today = window(day(hours, weekday, 0)) ?: return false
        if (today.start == today.end) return true
        return now >= today.start && (today.end < today.start || now < today.end)
    }

    /** Menit sejak toko tutup; null bila sedang buka atau tanpa jadwal. */
    fun minutesSinceClose(hours: List<OpeningHour>, nowMillis: Long, zone: ZoneId): Int? {
        if (hours.isEmpty() || isOpen(hours, nowMillis, zone)) return null
        val local = Instant.ofEpochMilli(nowMillis).atZone(zone)
        val weekday = local.dayOfWeek.value
        val now = local.hour * 60 + local.minute
        var latest: Int? = null
        for (offset in 0 downTo -7) {
            val window = window(day(hours, weekday, offset)) ?: continue
            val close = offset * 1440 + when {
                window.end == window.start -> 1440
                window.end < window.start -> window.end + 1440
                else -> window.end
            }
            if (close <= now && (latest == null || close > latest)) latest = close
        }
        return latest?.let { now - it }
    }

    /** Menit sejak tutup bila shift masih terbuka 2 jam lewat jam tutup (dan sejak dibuka), selain itu null. */
    fun shiftOverdue(hours: List<OpeningHour>, openedAtMillis: Long, nowMillis: Long, zone: ZoneId): Int? {
        val closed = minutesSinceClose(hours, nowMillis, zone) ?: return null
        val late = minOf(closed.toLong(), (nowMillis - openedAtMillis) / 60_000)
        return if (late >= SHIFT_OVERDUE_MINUTES) closed else null
    }
}
