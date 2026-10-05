// QRIS toko dengan nominal otomatis.
//
// QRIS memakai format EMVCo: rangkaian tag dua digit, panjang dua digit, lalu
// nilai, ditutup tag 63 berisi CRC16-CCITT. QRIS statis (tag 01 = "11") tidak
// membawa nominal. Dengan mengubah tag 01 menjadi "12" dan menambahkan tag 54
// (nominal), aplikasi bank dan e-wallet mengisi nominal pesanan secara
// otomatis. Dana tetap masuk ke merchant pemilik QRIS; Mangalli tidak menerima
// notifikasi, jadi kasir tetap menandai pesanan lunas setelah dana terlihat.

type Field = { tag: string; value: string };

export function crc16(input: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(input, "utf8")) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function parseFields(payload: string): Field[] {
  const fields: Field[] = [];
  let index = 0;
  while (index < payload.length) {
    const tag = payload.slice(index, index + 2);
    const length = Number(payload.slice(index + 2, index + 4));
    if (!/^\d{2}$/.test(tag) || !Number.isInteger(length) || index + 4 + length > payload.length) {
      throw new Error("Invalid QRIS code.");
    }
    fields.push({ tag, value: payload.slice(index + 4, index + 4 + length) });
    index += 4 + length;
  }
  return fields;
}

function field(tag: string, value: string) {
  return `${tag}${String(value.length).padStart(2, "0")}${value}`;
}

// Memeriksa QRIS yang diunggah owner: struktur, CRC, mata uang rupiah, dan
// ada data merchant. Mengembalikan payload yang sudah dirapikan.
export function normalizeStaticQris(raw: string): string {
  const payload = raw.trim();
  if (!payload.startsWith("000201")) throw new Error("Invalid QRIS code.");
  const fields = parseFields(payload);
  const crcField = fields.at(-1);
  if (crcField?.tag !== "63" || crcField.value.length !== 4) throw new Error("Invalid QRIS code.");
  if (crc16(payload.slice(0, -4)).toUpperCase() !== crcField.value.toUpperCase()) throw new Error("QRIS checksum does not match.");
  if (fields.find((item) => item.tag === "53")?.value !== "360") throw new Error("QRIS must be in rupiah.");
  if (!fields.some((item) => item.tag === "59")) throw new Error("QRIS has no merchant name.");
  return payload;
}

export function qrisMerchantName(payload: string): string | null {
  try {
    return parseFields(payload).find((item) => item.tag === "59")?.value ?? null;
  } catch {
    return null;
  }
}

export function dynamicQris(staticPayload: string, amount: number): string {
  if (!Number.isInteger(amount) || amount < 1 || amount > 99_999_999) throw new Error("Invalid QRIS amount.");
  const fields = parseFields(normalizeStaticQris(staticPayload)).filter((item) => item.tag !== "63" && item.tag !== "54");
  const withAmount = fields.map((item) => (item.tag === "01" ? { tag: "01", value: "12" } : item));
  if (!withAmount.some((item) => item.tag === "01")) withAmount.splice(1, 0, { tag: "01", value: "12" });
  const insertAt = withAmount.findIndex((item) => Number(item.tag) > 54);
  withAmount.splice(insertAt === -1 ? withAmount.length : insertAt, 0, { tag: "54", value: String(amount) });
  const body = `${withAmount.map((item) => field(item.tag, item.value)).join("")}6304`;
  return `${body}${crc16(body)}`;
}
