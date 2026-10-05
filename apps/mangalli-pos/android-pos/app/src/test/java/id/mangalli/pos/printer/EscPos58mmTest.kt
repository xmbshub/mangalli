package id.mangalli.pos.printer

import java.nio.charset.Charset
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EscPos58mmTest {
    private val sale = SalePrintData(
        outletName = "Mangalli Test",
        outletAddress = "Jl. Test No. 1",
        outletPhone = "+6281234567890",
        reference = "BILL-42",
        customerName = "Raka",
        orderContext = "Dine In - Table 4",
        items = listOf(
            PrintLineItem(
                name = "Iced Latte",
                quantity = 2,
                unitPrice = 25_000.0,
                modifiers = "Large - Less Ice",
                notes = "One drink without straw",
            )
        ),
        subtotal = 50_000.0,
        tax = 5_000.0,
        total = 55_000.0,
        paymentLabel = "Cash",
    )

    @Test
    fun billContainsPricesAndPendingPaymentLabel() {
        val text = EscPos58mm.bill(sale).asText()

        assertTrue(text.contains("CUSTOMER BILL"))
        assertTrue(text.contains("Rp 55.000"))
        assertTrue(text.contains("PAYMENT PENDING"))
        assertTrue(text.contains("Jl. Test No. 1"))
        assertTrue(text.contains("Powered by Mangalli"))
        assertTrue(text.contains("Developed by 1garis Studio"))
    }

    @Test
    fun kitchenTicketContainsInstructionsWithoutPrices() {
        val text = EscPos58mm.ticket(sale).asText()

        assertTrue(text.contains("KITCHEN TICKET"))
        assertTrue(text.contains("2x Iced Latte"))
        assertTrue(text.contains("NOTE: One drink without straw"))
        assertTrue(text.contains("TOTAL ITEMS: 2"))
        assertFalse(text.contains("Rp "))
    }

    @Test
    fun receiptContainsPaymentStatus() {
        val text = EscPos58mm.receipt(sale).asText()

        assertTrue(text.contains("PAYMENT RECEIPT"))
        assertTrue(text.contains("Payment"))
        assertTrue(text.contains("Cash"))
        assertTrue(text.contains("1garis.id"))
    }

    @Test
    fun customAmountPrintsOnBillButNotKitchenTicket() {
        val customSale = sale.copy(
            items = sale.items + PrintLineItem(
                name = "Custom Amount",
                quantity = 1,
                unitPrice = 10_000.0,
                modifiers = null,
                notes = null,
                sendToKitchen = false,
            )
        )

        assertTrue(EscPos58mm.bill(customSale).asText().contains("Custom Amount"))
        assertFalse(EscPos58mm.ticket(customSale).asText().contains("Custom Amount"))
    }

    private fun ByteArray.asText(): String = toString(Charset.forName("CP437"))

    // Kejadian 26 Sep: shift dibuka owner, ditutup kasir dengan kas kurang;
    // laporan dulu hanya menulis pembuka sebagai "Cashier".
    @Test
    fun shiftReportNamesWhoOpenedClosedAndApproved() {
        val text = EscPos58mm.shiftReport(
            ShiftReportData(
                outletName = "Kopi Senja", businessDate = "2026-09-26", openedAt = "26 Sep, 13:45", closedAt = "16:00",
                openedBy = "Budi Santoso", closedBy = "Sari Dewi", approvedBy = "Budi Santoso", note = "Beli galon",
                paidOrders = 12, cancelledOrders = 0, cashSales = 386_100.0, nonCashSales = 0.0,
                openingCash = 100_000.0, expectedCash = 486_100.0, countedCash = 400_000.0,
                cashMovements = listOf("Gallon water" to -20_000.0),
            )
        ).asText()

        assertTrue(text.contains("Opened by"))
        assertTrue(text.contains("Sari Dewi"))
        assertTrue(text.contains("Approved by"))
        assertTrue(text.contains("Note: Beli galon"))
        assertTrue(text.contains("-Rp 86.100"))
        assertTrue(text.contains("Out: Gallon water"))
        assertTrue(text.contains("-Rp 20.000"))
        assertFalse(text.contains("Cashier"))
    }

    @Test
    fun qrisBillAndSlipCarryTheQrCodeButReceiptsDoNot() {
        val payload = "00020101021226400014ID.CO.QRIS.WWW01189360091500000000015204581253033605405550005802ID5906WARUNG6008MAKASSAR6304ABCD"
        val withQris = sale.copy(qrisPayload = payload, qrisMerchant = "WARUNG")
        val store = byteArrayOf(0x1D, 0x28, 0x6B, (payload.length + 3).toByte(), 0, 0x31, 0x50, 0x30) + payload.toByteArray(Charsets.US_ASCII)
        for (document in listOf(EscPos58mm.bill(withQris), EscPos58mm.qrisSlip(withQris))) {
            assertTrue(document.asText().contains("SCAN TO PAY WITH QRIS"))
            assertTrue(document.containsSequence(store))
        }
        assertFalse(EscPos58mm.receipt(withQris).asText().contains("QRIS"))
        assertFalse(EscPos58mm.bill(sale).asText().contains("QRIS"))
    }

    private fun ByteArray.containsSequence(needle: ByteArray): Boolean =
        (0..size - needle.size).any { start -> needle.indices.all { this[start + it] == needle[it] } }
}
