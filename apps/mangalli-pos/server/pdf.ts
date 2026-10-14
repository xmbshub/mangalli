// Penulis PDF minimal tanpa dependensi untuk laporan dari Ask Eline: A4 (mendatar
// bila tabelnya lebar), font standar Helvetica (tidak perlu disematkan), kartu
// angka, daftar angka, dan tabel yang berlanjut ke halaman berikut dengan header
// diulang. Lebar huruf dari metrik AFM Helvetica: kolom selebar isinya, angka rata
// kanan dengan tepat, dan teks panjang dibungkus, tidak pernah dipotong "…"
// (insiden 13 Okt 2026: kode pesanan, tanggal, dan nama kasir terpotong).
import { deflateSync } from "node:zlib";

export type PdfSection =
  // Kartu angka di atas laporan (Sales, Paid orders, ...), paling banyak 4 sebaris.
  | { kind: "stats"; items: Array<{ label: string; value: string; hint?: string }> }
  // Baris "strong" tebal berlatar (subtotal seperti Sales, Gross profit, Net profit).
  | { kind: "kv"; heading: string; rows: Array<[string, string] | [string, string, "strong"]>; note?: string }
  // width = bobot kolom teks saat membagi sisa lebar; kolom angka selalu selebar isinya.
  | { kind: "table"; heading: string; columns: Array<{ header: string; align?: "left" | "right"; width?: number }>; rows: string[][]; total?: string[]; note?: string }
  | { kind: "text"; heading?: string; text: string };
export type PdfDocument = { title: string; subtitle?: string; generated?: string; sections: PdfSection[] };

// Lebar AFM (per 1000 unit) untuk karakter 32..126.
const REGULAR = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
const WIN_ANSI: Record<string, number> = { "€": 0x80, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, " ": 0x20, " ": 0x20 , "−": 0x2d };

// Teks ke byte WinAnsi; karakter di luar WinAnsi menjadi "?".
function encode(text: string): number[] {
  return Array.from(text, (char) => {
    const code = char.codePointAt(0)!;
    if (WIN_ANSI[char] !== undefined) return WIN_ANSI[char];
    if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255)) return code;
    return 63;
  });
}
function width(text: string, size: number, bold = false): number {
  const table = bold ? BOLD : REGULAR;
  return encode(text).reduce((sum, byte) => sum + (byte >= 32 && byte <= 126 ? table[byte - 32] : 556), 0) * size / 1000;
}
function fit(text: string, max: number, size: number, bold = false): string {
  if (width(text, size, bold) <= max) return text;
  let value = text;
  while (value.length > 1 && width(`${value}…`, size, bold) > max) value = value.slice(0, -1);
  return `${value.trimEnd()}…`;
}
const hex = (text: string) => `<${encode(text).map((byte) => byte.toString(16).padStart(2, "0")).join("")}>`;

// Bungkus teks ke beberapa baris selebar `max`; kata yang terlalu panjang dipecah per huruf.
// Paling banyak `limit` baris, baris terakhir diberi elipsis bila masih ada sisa.
function wrap(text: string, max: number, size: number, bold = false, limit = 3): string[] {
  const lines: string[] = [];
  let line = "";
  const push = (value: string) => { lines.push(value); line = ""; };
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let piece = word;
    while (width(piece, size, bold) > max) {
      let cut = piece.length - 1;
      while (cut > 1 && width(piece.slice(0, cut), size, bold) > max) cut -= 1;
      if (line) push(line);
      push(piece.slice(0, cut));
      piece = piece.slice(cut);
    }
    const next = line ? `${line} ${piece}` : piece;
    if (line && width(next, size, bold) > max) { push(line); line = piece; } else line = next;
  }
  if (line || !lines.length) lines.push(line);
  if (lines.length <= limit) return lines;
  return [...lines.slice(0, limit - 1), fit(lines.slice(limit - 1).join(" "), max, size, bold)];
}

const PORTRAIT: [number, number] = [595.28, 841.89];
const MARGIN = 42;
const INK = "0.094 0.094 0.106";
const TEXT = "0.247 0.247 0.275";
const MUTED = "0.443 0.443 0.478";
const ORANGE = "0.918 0.345 0.047";
const LINE = "0.894 0.894 0.906";
const SOFT = "0.957 0.957 0.961";
const FAINT = "0.980 0.980 0.984";
const CELL_PAD = 6;
const BODY = 9;
const HEAD = 8.5;
const LEADING = 11.5;

type TableSection = Extract<PdfSection, { kind: "table" }>;

// Lebar kolom dari isinya: kolom angka (rata kanan) selebar angka terpanjang dan tidak
// pernah dibungkus; kolom teks berbagi sisa lebar menurut bobotnya dan dibungkus bila sempit.
function natural(section: TableSection) {
  return section.columns.map((column, index) => {
    const cells = [...section.rows.map((row) => row[index] ?? ""), ...(section.total ? [section.total[index] ?? ""] : [])];
    // +1 pt: pembulatan lebar huruf tidak boleh membuat judul pas-pasan pecah ke baris baru.
    return Math.max(width(column.header, HEAD, true), ...cells.map((cell) => width(cell, BODY, true))) + CELL_PAD * 2 + 1;
  });
}

function columnWidths(section: TableSection, available: number): number[] {
  const wants = natural(section);
  const fixed = section.columns.map((column) => column.align === "right");
  const fixedTotal = wants.reduce((sum, want, index) => sum + (fixed[index] ? Math.min(want, available * 0.4) : 0), 0);
  const flexible = section.columns.map((_, index) => index).filter((index) => !fixed[index]);
  const result = wants.map((want, index) => (fixed[index] ? Math.min(want, available * 0.4) : want));
  if (!flexible.length) {
    const scale = available / result.reduce((sum, value) => sum + value, 0);
    return result.map((value) => value * scale);
  }
  const room = available - fixedTotal;
  const weight = (index: number) => section.columns[index].width ?? 1;
  const flexTotal = flexible.reduce((sum, index) => sum + result[index], 0);
  if (flexTotal <= room) {
    // Sisa lebar dibagi ke kolom teks menurut bobot.
    const extra = room - flexTotal;
    const weights = flexible.reduce((sum, index) => sum + weight(index), 0);
    flexible.forEach((index) => { result[index] += (extra * weight(index)) / weights; });
    return result;
  }
  // Terlalu lebar: kolom teks menyusut sebanding (minimal 56 pt) dan isinya dibungkus.
  const minimum = 56;
  let scale = (room - minimum * flexible.length) / Math.max(1, flexTotal - minimum * flexible.length);
  scale = Math.max(0, scale);
  flexible.forEach((index) => { result[index] = minimum + Math.max(0, result[index] - minimum) * scale; });
  const total = result.reduce((sum, value) => sum + value, 0);
  return total > available ? result.map((value) => (value * available) / total) : result;
}

export function buildPdf(doc: PdfDocument, footer = "Mangalli POS · Developed by 1garis Studio"): Buffer {
  // Tabel lebar (mis. daftar pesanan) memakai A4 mendatar supaya tidak ada kolom terpotong.
  const portraitWidth = PORTRAIT[0] - MARGIN * 2;
  const landscape = doc.sections.some((section) => section.kind === "table" && natural(section).reduce((sum, value) => sum + value, 0) > portraitWidth * 1.08);
  const [PAGE_W, PAGE_H] = landscape ? [PORTRAIT[1], PORTRAIT[0]] : PORTRAIT;
  const contentWidth = PAGE_W - MARGIN * 2;
  const bottom = PAGE_H - MARGIN - 28;

  const pages: string[][] = [];
  let ops: string[] = [];
  let y = 0;
  const text = (value: string, x: number, top: number, size: number, opts: { bold?: boolean; color?: string } = {}) =>
    ops.push(`BT /${opts.bold ? "F2" : "F1"} ${size} Tf ${opts.color ?? INK} rg ${x.toFixed(2)} ${(PAGE_H - top - size * 0.82).toFixed(2)} Td ${hex(value)} Tj ET`);
  const rect = (x: number, top: number, w: number, h: number, color: string) => ops.push(`${color} rg ${x.toFixed(2)} ${(PAGE_H - top - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  const frame = (x: number, top: number, w: number, h: number, color: string) => ops.push(`${color} RG 0.8 w ${x.toFixed(2)} ${(PAGE_H - top - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`);
  const rule = (top: number, color = LINE, thickness = 0.6) => rect(MARGIN, top, contentWidth, thickness, color);
  const right = (value: string, edge: number, top: number, size: number, opts: { bold?: boolean; color?: string } = {}) => text(value, edge - width(value, size, opts.bold), top, size, opts);
  const newPage = () => { ops = []; pages.push(ops); y = MARGIN; };
  const ensure = (height: number) => { if (y + height > bottom) { newPage(); return true; } return false; };
  const heading = (value: string) => { text(value, MARGIN, y, 12, { bold: true }); y += 22; };

  newPage();
  text("MANGALLI POS", MARGIN, y, 7.5, { bold: true, color: ORANGE });
  if (doc.generated) right(doc.generated, MARGIN + contentWidth, y, 7.5, { color: MUTED });
  y += 16;
  wrap(doc.title, contentWidth, 20, true, 2).forEach((line) => { text(line, MARGIN, y, 20, { bold: true }); y += 25; });
  if (doc.subtitle) { text(fit(doc.subtitle, contentWidth, 10), MARGIN, y, 10, { color: MUTED }); y += 16; }
  rect(MARGIN, y + 2, 40, 2, ORANGE);
  y += 22;

  for (const section of doc.sections) {
    if (section.kind === "stats") {
      const items = section.items.slice(0, 4);
      const gap = 10;
      const boxWidth = (contentWidth - gap * (items.length - 1)) / items.length;
      const boxHeight = items.some((item) => item.hint) ? 62 : 50;
      ensure(boxHeight + 16);
      items.forEach((item, index) => {
        const x = MARGIN + index * (boxWidth + gap);
        rect(x, y, boxWidth, boxHeight, FAINT);
        frame(x, y, boxWidth, boxHeight, LINE);
        text(fit(item.label, boxWidth - 20, 8.5), x + 10, y + 10, 8.5, { color: MUTED });
        text(fit(item.value, boxWidth - 20, 14, true), x + 10, y + 25, 14, { bold: true });
        if (item.hint) text(fit(item.hint, boxWidth - 20, 7.5), x + 10, y + 46, 7.5, { color: MUTED });
      });
      y += boxHeight + 22;
      continue;
    }
    if (section.kind === "text") {
      if (section.heading) { ensure(40); heading(section.heading); }
      for (const line of wrap(section.text, contentWidth, 10, false, 200)) { ensure(15); text(line, MARGIN, y, 10, { color: TEXT }); y += 15; }
      y += 12;
      continue;
    }
    ensure(72);
    heading(section.heading);
    if (section.kind === "kv") {
      rule(y - 4);
      for (const [label, value, tone] of section.rows) {
        const strong = tone === "strong";
        if (ensure(20)) { heading(`${section.heading} (continued)`); rule(y - 4); }
        if (strong) rect(MARGIN, y - 4, contentWidth, 20, SOFT);
        text(fit(label, contentWidth * 0.62, 9.5, strong), MARGIN + CELL_PAD, y + 1, 9.5, { bold: strong, color: strong ? INK : TEXT });
        right(value, MARGIN + contentWidth - CELL_PAD, y + 1, 9.5, { bold: strong, color: value.startsWith("-") && !strong ? MUTED : INK });
        y += 20;
        rule(y - 4);
      }
    } else {
      const widths = columnWidths(section, contentWidth);
      const header = () => {
        const lines = section.columns.map((column, index) => wrap(column.header, widths[index] - CELL_PAD * 2, HEAD, true, 2));
        const height = Math.max(...lines.map((value) => value.length)) * 10.5 + 9;
        rect(MARGIN, y, contentWidth, height, SOFT);
        let x = MARGIN;
        section.columns.forEach((column, index) => {
          lines[index].forEach((line, row) => {
            const top = y + 5 + row * 10.5;
            if (column.align === "right") right(line, x + widths[index] - CELL_PAD, top, HEAD, { bold: true, color: MUTED });
            else text(line, x + CELL_PAD, top, HEAD, { bold: true, color: MUTED });
          });
          x += widths[index];
        });
        y += height;
      };
      const row = (cells: string[], total = false) => {
        const lines = section.columns.map((column, index) => (column.align === "right"
          ? [fit(cells[index] ?? "", widths[index] - CELL_PAD * 2, BODY, total)]
          : wrap(cells[index] ?? "", widths[index] - CELL_PAD * 2, BODY, total)));
        const height = Math.max(...lines.map((value) => value.length)) * LEADING + 9;
        if (ensure(height)) { heading(`${section.heading} (continued)`); header(); }
        if (total) { rect(MARGIN, y, contentWidth, height, SOFT); rule(y, MUTED, 0.8); }
        let x = MARGIN;
        section.columns.forEach((column, index) => {
          lines[index].forEach((line, lineIndex) => {
            const top = y + 5 + lineIndex * LEADING;
            if (column.align === "right") right(line, x + widths[index] - CELL_PAD, top, BODY, { bold: total });
            else text(line, x + CELL_PAD, top, BODY, { bold: total, color: total ? INK : TEXT });
          });
          x += widths[index];
        });
        y += height;
        if (!total) rule(y - 0.6, LINE, 0.5);
      };
      header();
      section.rows.forEach((cells) => row(cells));
      if (!section.rows.length) { text("Nothing in this period.", MARGIN + CELL_PAD, y + 6, BODY, { color: MUTED }); y += 22; }
      if (section.total && section.rows.length) row(section.total, true);
    }
    if (section.note) {
      y += 4;
      for (const line of wrap(section.note, contentWidth, 8.5, false, 4)) { ensure(14); text(line, MARGIN, y, 8.5, { color: MUTED }); y += 12; }
    }
    y += 20;
  }

  // Kaki halaman ditulis setelah jumlah halaman diketahui.
  pages.forEach((page, index) => {
    ops = page;
    rect(MARGIN, PAGE_H - MARGIN - 12, contentWidth, 0.6, LINE);
    text(footer, MARGIN, PAGE_H - MARGIN - 4, 7.5, { color: MUTED });
    right(`Page ${index + 1} of ${pages.length}`, MARGIN + contentWidth, PAGE_H - MARGIN - 4, 7.5, { color: MUTED });
  });
  // Rakit objek PDF: 1 katalog, 2 daftar halaman, 3-4 font, lalu halaman + isi.
  const objects: Buffer[] = [];
  const add = (body: string | Buffer) => { objects.push(typeof body === "string" ? Buffer.from(body, "latin1") : body); return objects.length; };
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add("PAGES");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const kids: number[] = [];
  for (const page of pages) {
    const stream = deflateSync(Buffer.from(page.join("\n"), "latin1"));
    const content = add(Buffer.concat([Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`, "latin1"), stream, Buffer.from("\nendstream", "latin1")]));
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(" ")}] /Count ${kids.length} >>`, "latin1");
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets: number[] = [];
  let length = parts[0].length;
  objects.forEach((body, index) => {
    offsets.push(length);
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, "latin1"), body, Buffer.from("\nendobj\n", "latin1")]);
    parts.push(chunk);
    length += chunk.length;
  });
  const info = `(${doc.title.replace(/[()\\]/g, "").replace(/[^\x20-\x7e]/g, "")})`;
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)].join("");
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info << /Title ${info} /Producer (Mangalli POS) >> >>\nstartxref\n${length}\n%%EOF\n`, "latin1"));
  return Buffer.concat(parts);
}
