package id.mangalli.pos.printer

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.util.Log
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.Charset
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

enum class PrinterRole {
    RECEIPT,
    KITCHEN,
}

data class PairedPrinter(
    val name: String,
    val address: String,
)

data class PrintLineItem(
    val name: String,
    val quantity: Int,
    val unitPrice: Double,
    val modifiers: String?,
    val notes: String?,
    val sendToKitchen: Boolean = true,
)

data class ShiftReportData(
    val outletName: String,
    val businessDate: String,
    val openedAt: String,
    val closedAt: String,
    val openedBy: String,
    val closedBy: String,
    val approvedBy: String?,
    val note: String?,
    val paidOrders: Int,
    val cancelledOrders: Int,
    val cashSales: Double,
    val nonCashSales: Double,
    val openingCash: Double,
    val expectedCash: Double,
    val countedCash: Double?,
    // Cash in/out: (alasan, jumlah bertanda) — negatif untuk uang keluar.
    val cashMovements: List<Pair<String, Double>> = emptyList(),
)

data class SalePrintData(
    val outletName: String,
    val outletAddress: String? = null,
    val outletPhone: String? = null,
    val outletLogoRaster: ByteArray? = null,
    val reference: String,
    val customerName: String,
    val orderContext: String,
    val items: List<PrintLineItem>,
    val subtotal: Double,
    val tax: Double,
    val total: Double,
    val paymentLabel: String? = null,
    // Cetak ulang: struk bertanda COPY supaya tidak dipakai sebagai bukti baru.
    val isCopy: Boolean = false,
    val discount: Double = 0.0,
    val discountLabel: String? = null,
    // QRIS dinamis berisi total; dicetak di bill dan slip QRIS supaya pelanggan
    // memindainya dari kertas seperti struk mesin EDC.
    val qrisPayload: String? = null,
    val qrisMerchant: String? = null,
)

class BluetoothPrinterStore(context: Context) {
    private val preferences = context.getSharedPreferences("bluetooth_printers", Context.MODE_PRIVATE)

    fun address(role: PrinterRole): String? = preferences.getString(role.key, null)
    fun name(role: PrinterRole): String? = preferences.getString("${role.key}_name", null)

    fun save(role: PrinterRole, address: String, name: String) {
        preferences.edit()
            .putString(role.key, address)
            .putString("${role.key}_name", name)
            .apply()
    }

    fun clear(role: PrinterRole) {
        preferences.edit().remove(role.key).remove("${role.key}_name").apply()
    }

    private val PrinterRole.key: String
        get() = when (this) {
            PrinterRole.RECEIPT -> "receipt_printer_address"
            PrinterRole.KITCHEN -> "kitchen_printer_address"
        }
}

class BluetoothEscPosPrinter(private val context: Context) {
    private val adapter
        get() = context.getSystemService(BluetoothManager::class.java)?.adapter

    fun hasConnectPermission(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED

    @SuppressLint("MissingPermission")
    fun pairedPrinters(): List<PairedPrinter> {
        check(hasConnectPermission()) { "Nearby devices permission is required." }
        val bluetoothAdapter = adapter ?: error("Bluetooth is not available on this device.")
        check(bluetoothAdapter.isEnabled) { "Turn on Bluetooth first." }

        return bluetoothAdapter.bondedDevices
            .map { device -> PairedPrinter(device.name ?: "Bluetooth printer", device.address) }
            .sortedBy { it.name.lowercase(Locale.ROOT) }
    }

    @SuppressLint("MissingPermission")
    fun print(address: String, document: ByteArray) {
        check(hasConnectPermission()) { "Nearby devices permission is required." }
        val bluetoothAdapter = adapter ?: error("Bluetooth is not available on this device.")
        check(bluetoothAdapter.isEnabled) { "Turn on Bluetooth first." }

        val socket = bluetoothAdapter
            .getRemoteDevice(address)
            .createRfcommSocketToServiceRecord(SPP_UUID)

        try {
            connectWithTimeout(socket::connect) { socket.close() }
            val output = socket.outputStream
            var offset = 0
            while (offset < document.size) {
                val byteCount = minOf(WRITE_CHUNK_BYTES, document.size - offset)
                output.write(document, offset, byteCount)
                output.flush()
                offset += byteCount
                if (offset < document.size) Thread.sleep(WRITE_CHUNK_DELAY_MS)
            }
            Thread.sleep(OUTPUT_DRAIN_DELAY_MS)
            Log.i(TAG, "Sent ${document.size} bytes to Bluetooth printer ${address.takeLast(5)}")
        } finally {
            runCatching { socket.close() }
        }
    }

    private fun connectWithTimeout(connect: () -> Unit, close: () -> Unit) {
        val executor = Executors.newSingleThreadExecutor()
        val connection = executor.submit(connect)
        try {
            connection.get(CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        } catch (_: TimeoutException) {
            runCatching(close)
            throw IOException("Printer connection timed out. Check that the printer is on and not connected to another device.")
        } catch (error: ExecutionException) {
            throw error.cause ?: error
        } finally {
            connection.cancel(true)
            executor.shutdownNow()
        }
    }

    companion object {
        private const val TAG = "MangalliPrinter"
        private const val CONNECT_TIMEOUT_SECONDS = 10L
        private const val WRITE_CHUNK_BYTES = 256
        private const val WRITE_CHUNK_DELAY_MS = 30L
        private const val OUTPUT_DRAIN_DELAY_MS = 500L
        private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    }
}

object EscPos58mm {
    private const val COLUMNS = 32
    private val charset: Charset = Charset.forName("CP437")

    fun test(role: PrinterRole): ByteArray = document {
        center()
        bold(true)
        size(doubleWidth = true, doubleHeight = true)
        line("MANGALLI POS")
        size(doubleWidth = false, doubleHeight = false)
        bold(false)
        line(if (role == PrinterRole.KITCHEN) "KITCHEN TICKET PRINTER" else "RECEIPT / BILL PRINTER")
        line(separator())
        line("58 mm Bluetooth test")
        line(timestamp())
        feed(4)
    }

    fun bill(data: SalePrintData): ByteArray = document {
        header(data, "CUSTOMER BILL")
        data.items.forEach { pricedItem(it) }
        line(separator())
        amount("Subtotal", data.subtotal)
        if (data.discount > 0) amount(data.discountLabel ?: "Discount", -data.discount)
        amount("Tax", data.tax)
        bold(true)
        amount("TOTAL", data.total)
        bold(false)
        line(separator())
        center()
        line("PAYMENT PENDING")
        line("This is not a payment receipt")
        data.qrisPayload?.let { qrisBlock(it, data.qrisMerchant, data.total) }
        brandFooter()
        feed(4)
    }

    // Slip QRIS ala mesin EDC: nominal dan kode QR untuk satu pembayaran.
    fun qrisSlip(data: SalePrintData): ByteArray = document {
        outletIdentity(data)
        line("QRIS PAYMENT")
        line(separator())
        left()
        pair("Reference", data.reference)
        pair("Time", timestamp())
        pair("Order", data.orderContext)
        line(separator())
        qrisBlock(data.qrisPayload ?: return@document, data.qrisMerchant, data.total)
        line(separator())
        line("Show the payment success")
        line("screen to the cashier")
        feed(4)
    }

    fun receipt(data: SalePrintData): ByteArray = document {
        header(data, if (data.isCopy) "PAYMENT RECEIPT - COPY" else "PAYMENT RECEIPT")
        data.items.forEach { pricedItem(it) }
        line(separator())
        amount("Subtotal", data.subtotal)
        if (data.discount > 0) amount(data.discountLabel ?: "Discount", -data.discount)
        amount("Tax", data.tax)
        bold(true)
        amount("TOTAL", data.total)
        bold(false)
        data.paymentLabel?.let { pair("Payment", it) }
        line(separator())
        brandFooter()
        feed(4)
    }

    fun ticket(data: SalePrintData): ByteArray = document {
        outletIdentity(data)
        line(separator('='))
        bold(true)
        size(doubleWidth = true, doubleHeight = true)
        wrapped(data.reference)
        size(doubleWidth = false, doubleHeight = false)
        line("KITCHEN TICKET")
        bold(false)
        line(separator('='))
        left()
        pair("Time", timestamp())
        pair("Order", data.orderContext)
        pair("Customer", data.customerName)
        line(separator('='))
        data.items.filter(PrintLineItem::sendToKitchen).forEach { item ->
            bold(true)
            size(doubleWidth = false, doubleHeight = true)
            wrapped("${item.quantity}x ${item.name}")
            size(doubleWidth = false, doubleHeight = false)
            bold(false)
            item.modifiers?.takeIf { it.isNotBlank() }?.let { wrapped("+ $it") }
            item.notes?.takeIf { it.isNotBlank() }?.let {
                bold(true)
                wrapped("NOTE: $it")
                bold(false)
            }
            line(separator())
        }
        center()
        bold(true)
        line("TOTAL ITEMS: ${data.items.filter(PrintLineItem::sendToKitchen).sumOf(PrintLineItem::quantity)}")
        bold(false)
        line("KITCHEN COPY - NO PRICES")
        feed(4)
    }

    // Laporan tutup shift untuk arsip kasir: kas awal, penjualan per jenis,
    // kas seharusnya, kas dihitung, dan selisihnya.
    fun shiftReport(data: ShiftReportData): ByteArray = document {
        center()
        bold(true)
        size(doubleWidth = true, doubleHeight = true)
        wrapped(data.outletName.uppercase(Locale.ROOT))
        size(doubleWidth = false, doubleHeight = false)
        line("SHIFT REPORT")
        bold(false)
        line(separator())
        left()
        pair("Date", data.businessDate)
        pair("Opened", data.openedAt)
        pair("Closed", data.closedAt)
        pair("Opened by", data.openedBy)
        pair("Closed by", data.closedBy)
        line(separator())
        pair("Paid orders", data.paidOrders.toString())
        pair("Cancelled", data.cancelledOrders.toString())
        amount("Cash sales", data.cashSales)
        amount("Non-cash sales", data.nonCashSales)
        line(separator())
        amount("Opening cash", data.openingCash)
        data.cashMovements.forEach { (reason, value) ->
            pair(if (value < 0) "Out: $reason" else "In: $reason", (if (value < 0) "-" else "+") + money(kotlin.math.abs(value)))
        }
        bold(true)
        amount("Expected cash", data.expectedCash)
        bold(false)
        data.countedCash?.let { counted ->
            amount("Counted cash", counted)
            val difference = counted - data.expectedCash
            bold(true)
            pair("Difference", (if (difference < 0) "-" else if (difference > 0) "+" else "") + money(kotlin.math.abs(difference)))
            bold(false)
        }
        data.approvedBy?.let { pair("Approved by", it) }
        data.note?.let { wrapped("Note: $it") }
        line(separator())
        center()
        line("Printed ${timestamp()}")
        line("Powered by Mangalli")
        feed(4)
    }

    private fun document(block: EscPosWriter.() -> Unit): ByteArray =
        EscPosWriter().apply {
            initialize()
            block()
        }.bytes()

    private fun EscPosWriter.header(data: SalePrintData, title: String) {
        outletIdentity(data)
        line(title)
        line(separator())
        left()
        pair("Reference", data.reference)
        pair("Time", timestamp())
        pair("Customer", data.customerName)
        pair("Order", data.orderContext)
        line(separator())
    }

    private fun EscPosWriter.pricedItem(item: PrintLineItem) {
        bold(true)
        wrapped(item.name)
        bold(false)
        pair("${item.quantity} x ${money(item.unitPrice)}", money(item.unitPrice * item.quantity))
        item.modifiers?.takeIf { it.isNotBlank() }?.let { wrapped("  + $it") }
        item.notes?.takeIf { it.isNotBlank() }?.let { wrapped("  Note: $it") }
        line("")
    }

    private fun EscPosWriter.amount(label: String, value: Double) = pair(label, money(value))

    private fun money(value: Double): String = "${if (value < 0) "-" else ""}Rp ${NumberFormat.getIntegerInstance(Locale.forLanguageTag("id-ID")).format(kotlin.math.abs(value))}"

    private fun timestamp(): String = SimpleDateFormat("dd/MM/yyyy HH:mm", Locale.US).format(Date())

    private fun EscPosWriter.outletIdentity(data: SalePrintData) {
        center()
        data.outletLogoRaster?.let {
            raw(it)
            line("")
        }
        bold(true)
        size(doubleWidth = true, doubleHeight = true)
        wrapped(data.outletName.uppercase(Locale.ROOT))
        size(doubleWidth = false, doubleHeight = false)
        bold(false)
        data.outletAddress?.takeIf(String::isNotBlank)?.let(::wrapped)
        data.outletPhone?.takeIf(String::isNotBlank)?.let(::wrapped)
    }

    private fun EscPosWriter.qrisBlock(payload: String, merchant: String?, total: Double) {
        center()
        line("")
        bold(true)
        line("SCAN TO PAY WITH QRIS")
        size(doubleWidth = true, doubleHeight = true)
        line(money(total))
        size(doubleWidth = false, doubleHeight = false)
        bold(false)
        qr(payload)
        merchant?.let { wrapped(it) }
        line("Any bank or e-wallet app")
        line("")
    }

    private fun EscPosWriter.brandFooter() {
        center()
        line("Thank you")
        line(separator())
        line("Powered by Mangalli")
        line("Developed by 1garis Studio")
        line("mangalli.web.id | 1garis.id")
    }

    private fun separator(character: Char = '-'): String = character.toString().repeat(COLUMNS)

    private class EscPosWriter {
        private val output = ByteArrayOutputStream()

        fun initialize() = command(0x1B, 0x40)
        fun left() = command(0x1B, 0x61, 0)
        fun center() = command(0x1B, 0x61, 1)
        fun bold(enabled: Boolean) = command(0x1B, 0x45, if (enabled) 1 else 0)
        fun size(doubleWidth: Boolean, doubleHeight: Boolean) =
            command(0x1D, 0x21, (if (doubleWidth) 0x20 else 0) or (if (doubleHeight) 0x01 else 0))

        fun line(value: String) {
            output.write(value.toByteArray(charset))
            output.write('\n'.code)
        }

        fun raw(value: ByteArray) {
            output.write(value)
        }

        fun wrapped(value: String) {
            wrap(value).forEach(::line)
        }

        fun pair(left: String, right: String) {
            val safeRight = right.takeLast(COLUMNS - 9)
            val maxLeft = (COLUMNS - safeRight.length - 1).coerceAtLeast(8)
            val leftLines = wrap(left, maxLeft)
            leftLines.dropLast(1).forEach(::line)
            val lastLeft = leftLines.lastOrNull().orEmpty().take(maxLeft)
            line(lastLeft + " ".repeat((COLUMNS - lastLeft.length - safeRight.length).coerceAtLeast(1)) + safeRight)
        }

        // Kode QR bawaan printer (ESC/POS GS ( k): model 2, modul 6 titik
        // (sekitar 40 mm di kertas 58 mm), koreksi galat M.
        fun qr(data: String, moduleSize: Int = 6) {
            val bytes = data.toByteArray(Charsets.US_ASCII)
            val length = bytes.size + 3
            command(0x1D, 0x28, 0x6B, 4, 0, 0x31, 0x41, 0x32, 0x00)
            command(0x1D, 0x28, 0x6B, 3, 0, 0x31, 0x43, moduleSize)
            command(0x1D, 0x28, 0x6B, 3, 0, 0x31, 0x45, 0x31)
            command(0x1D, 0x28, 0x6B, length and 0xFF, (length shr 8) and 0xFF, 0x31, 0x50, 0x30)
            output.write(bytes)
            command(0x1D, 0x28, 0x6B, 3, 0, 0x31, 0x51, 0x30)
            line("")
        }

        fun feed(lines: Int) = repeat(lines) { line("") }

        fun bytes(): ByteArray = output.toByteArray()

        private fun command(vararg values: Int) {
            values.forEach(output::write)
        }

        private fun wrap(value: String, width: Int = COLUMNS): List<String> {
            val words = value.trim().split(Regex("\\s+")).filter(String::isNotBlank)
            if (words.isEmpty()) return listOf("")

            val lines = mutableListOf<String>()
            var current = ""
            words.forEach { word ->
                val chunks = word.chunked(width)
                chunks.forEachIndexed { index, chunk ->
                    val candidate = if (current.isBlank()) chunk else "$current $chunk"
                    if (candidate.length <= width) {
                        current = candidate
                    } else {
                        lines += current
                        current = chunk
                    }
                    if (index < chunks.lastIndex) {
                        lines += current
                        current = ""
                    }
                }
            }
            if (current.isNotBlank()) lines += current
            return lines
        }
    }
}

object EscPosLogo {
    private const val MAX_WIDTH = 160
    private const val MAX_HEIGHT = 128
    private val dither = arrayOf(
        intArrayOf(0, 8, 2, 10),
        intArrayOf(12, 4, 14, 6),
        intArrayOf(3, 11, 1, 9),
        intArrayOf(15, 7, 13, 5),
    )

    fun downloadRaster(url: String): ByteArray? {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 5_000
            readTimeout = 5_000
            instanceFollowRedirects = true
        }

        return try {
            check(connection.responseCode in 200..299) { "Outlet logo returned HTTP ${connection.responseCode}." }
            connection.inputStream.use(BitmapFactory::decodeStream)?.let(::rasterize)
        } finally {
            connection.disconnect()
        }
    }

    private fun rasterize(source: Bitmap): ByteArray {
        val scale = minOf(
            1f,
            MAX_WIDTH.toFloat() / source.width.coerceAtLeast(1),
            MAX_HEIGHT.toFloat() / source.height.coerceAtLeast(1),
        )
        val width = (source.width * scale).toInt().coerceAtLeast(1)
        val height = (source.height * scale).toInt().coerceAtLeast(1)
        val bitmap = if (width == source.width && height == source.height) {
            source
        } else {
            Bitmap.createScaledBitmap(source, width, height, true)
        }
        val bytesPerRow = (width + 7) / 8
        val pixels = ByteArray(bytesPerRow * height)

        for (y in 0 until height) {
            for (x in 0 until width) {
                val color = bitmap.getPixel(x, y)
                val alpha = color ushr 24 and 0xFF
                val red = color ushr 16 and 0xFF
                val green = color ushr 8 and 0xFF
                val blue = color and 0xFF
                val luminance = (red * 299 + green * 587 + blue * 114) / 1_000
                val threshold = dither[y % 4][x % 4] * 16 + 8
                if (alpha > 32 && luminance < threshold) {
                    val index = y * bytesPerRow + (x / 8)
                    pixels[index] = (pixels[index].toInt() or (0x80 shr (x % 8))).toByte()
                }
            }
        }

        return ByteArrayOutputStream().apply {
            write(byteArrayOf(0x1D, 0x76, 0x30, 0x00))
            write(bytesPerRow and 0xFF)
            write(bytesPerRow shr 8 and 0xFF)
            write(height and 0xFF)
            write(height shr 8 and 0xFF)
            write(pixels)
        }.toByteArray()
    }
}
