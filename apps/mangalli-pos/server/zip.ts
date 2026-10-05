// Zip minimal tanpa dependensi: tulis (STORE atau DEFLATE) untuk XLSX dan
// ekspor data, baca (STORE/DEFLATE) untuk impor data. Tanpa ZIP64, jadi tiap
// berkas dan arsip di bawah 4 GB; batas impor jauh lebih kecil.
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

export type ZipEntry = { name: string; data: Buffer };

export function zip(files: ZipEntry[], compress = false): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const crc = crc32(file.data) >>> 0;
    const body = compress ? deflateRawSync(file.data) : file.data;
    const method = compress ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10); central.writeUInt32LE(0, 12); central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(file.data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

// Baca arsip lewat central directory; CRC dan batas ukuran total diperiksa
// supaya berkas rusak atau "zip bomb" ditolak.
export function unzip(archive: Buffer, maxTotal = 512 * 1024 * 1024): Map<string, Buffer> {
  let endAt = -1;
  for (let i = archive.length - 22; i >= Math.max(0, archive.length - 22 - 65535); i -= 1) {
    if (archive.readUInt32LE(i) === 0x06054b50) { endAt = i; break; }
  }
  if (endAt < 0) throw new Error("Not a zip file.");
  const count = archive.readUInt16LE(endAt + 10);
  let at = archive.readUInt32LE(endAt + 16);
  const files = new Map<string, Buffer>();
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    if (archive.readUInt32LE(at) !== 0x02014b50) throw new Error("Damaged zip file.");
    const method = archive.readUInt16LE(at + 10);
    const crc = archive.readUInt32LE(at + 16);
    const size = archive.readUInt32LE(at + 20);
    const rawSize = archive.readUInt32LE(at + 24);
    const nameLength = archive.readUInt16LE(at + 28);
    const extraLength = archive.readUInt16LE(at + 30);
    const commentLength = archive.readUInt16LE(at + 32);
    const localAt = archive.readUInt32LE(at + 42);
    const name = archive.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    at += 46 + nameLength + extraLength + commentLength;
    total += rawSize;
    if (total > maxTotal) throw new Error("The file is too large.");
    const dataAt = localAt + 30 + archive.readUInt16LE(localAt + 26) + archive.readUInt16LE(localAt + 28);
    const body = archive.subarray(dataAt, dataAt + size);
    const data = method === 0 ? Buffer.from(body) : method === 8 ? inflateRawSync(body, { maxOutputLength: rawSize }) : null;
    if (!data || data.length !== rawSize || (crc32(data) >>> 0) !== crc) throw new Error("Damaged zip file.");
    if (!name.endsWith("/")) files.set(name, data);
  }
  return files;
}
