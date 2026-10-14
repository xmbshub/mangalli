package id.mangalli.pos.offline

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.OffsetDateTime
import java.time.ZoneId

// Kasus yang sama dengan server/opening-hours.test.ts. 26 Sep 2026 = Sabtu; Asia/Makassar = UTC+8.
class OpeningHoursTest {
    private val zone = ZoneId.of("Asia/Makassar")
    private val days = listOf("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
    private fun every(open: String, close: String) = days.map { OpeningHour(it, true, open, close) }
    private fun at(local: String) = OffsetDateTime.parse("$local+08:00").toInstant().toEpochMilli()

    @Test
    fun minutesSinceCloseFollowsOvernightClosedAndAllDayHours() {
        val cafe = every("07:00", "05:00")
        assertNull(OpeningHours.minutesSinceClose(cafe, at("2026-09-27T02:00:00"), zone))
        assertEquals(90, OpeningHours.minutesSinceClose(cafe, at("2026-09-27T06:30:00"), zone))
        val shop = every("08:00", "17:00").map { if (it.key == "sunday") it.copy(isOpen = false) else it }
        assertEquals(135, OpeningHours.minutesSinceClose(shop, at("2026-09-26T19:15:00"), zone))
        assertEquals(17 * 60, OpeningHours.minutesSinceClose(shop, at("2026-09-27T10:00:00"), zone))
        assertEquals(38 * 60, OpeningHours.minutesSinceClose(shop, at("2026-09-28T07:00:00"), zone))
        val allDaySaturday = shop.map { if (it.key == "saturday") it.copy(openTime = "00:00", closeTime = "00:00") else it }
        assertEquals(60, OpeningHours.minutesSinceClose(allDaySaturday, at("2026-09-27T01:00:00"), zone))
        assertNull(OpeningHours.minutesSinceClose(emptyList(), at("2026-09-27T01:00:00"), zone))
    }

    @Test
    fun shiftIsOverdueTwoHoursAfterClosingOrAfterItWasOpened() {
        val shop = every("08:00", "17:00")
        assertNull(OpeningHours.shiftOverdue(shop, at("2026-09-26T08:00:00"), at("2026-09-26T18:59:00"), zone))
        assertEquals(120, OpeningHours.shiftOverdue(shop, at("2026-09-26T08:00:00"), at("2026-09-26T19:00:00"), zone))
        assertNull(OpeningHours.shiftOverdue(shop, at("2026-09-26T20:00:00"), at("2026-09-26T21:00:00"), zone))
        assertEquals(300, OpeningHours.shiftOverdue(shop, at("2026-09-26T20:00:00"), at("2026-09-26T22:00:00"), zone))
    }

    @Test
    fun parsesTheDashboardFormat() {
        val hours = OpeningHours.parse("""[{"key":"monday","day":"Senin","is_open":true,"open_time":"07:00","close_time":"05:00"},{"key":"sunday","is_open":false}]""")
        assertEquals(OpeningHour("monday", true, "07:00", "05:00"), hours[0])
        assertEquals(OpeningHour("sunday", false, null, null), hours[1])
    }
}
