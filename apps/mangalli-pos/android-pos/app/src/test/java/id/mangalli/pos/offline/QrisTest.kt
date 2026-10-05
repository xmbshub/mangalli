package id.mangalli.pos.offline

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class QrisTest {
    // Nilai dari server/qris.ts untuk QRIS contoh yang sama: tablet dan server harus identik.
    private val static = "00020101021126400014ID.CO.QRIS.WWW01189360091500000000015204581253033605802ID5906WARUNG6008MAKASSAR6304F899"

    @Test
    fun dynamicQrisMatchesTheServer() {
        assertEquals(
            "00020101021226400014ID.CO.QRIS.WWW01189360091500000000015204581253033605405275005802ID5906WARUNG6008MAKASSAR6304B8DD",
            Qris.dynamic(static, 27_500),
        )
        assertEquals("WARUNG", Qris.merchantName(static))
    }

    @Test
    fun brokenOrMissingQrisGivesNothing() {
        assertNull(Qris.dynamic(null, 10_000))
        assertNull(Qris.dynamic(static.dropLast(1) + "0", 10_000))
        assertNull(Qris.dynamic(static, 0))
    }
}
