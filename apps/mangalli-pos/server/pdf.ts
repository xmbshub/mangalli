// Penulis PDF minimal tanpa dependensi untuk laporan dari Ask Eline: A4, font
// standar Helvetica (tidak perlu disematkan), judul, daftar angka, dan tabel
// yang berlanjut ke halaman berikut dengan header diulang. Lebar huruf dari
// metrik AFM Helvetica supaya angka bisa rata kanan dengan tepat.
import { deflateSync } from "node:zlib";

export type PdfSection =
  | { kind: "kv"; heading: string; rows: Array<[string, string]>; note?: string }
  | { kind: "table"; heading: string; columns: Array<{ header: string; align?: "left" | "right"; width?: number }>; rows: string[][]; note?: string }
  | { kind: "text"; heading?: string; text: string };
export type PdfDocument = { title: string; subtitle?: string; sections: PdfSection[] };

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

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 42;
const INK = "0.094 0.094 0.106";
const MUTED = "0.443 0.443 0.478";
const ORANGE = "0.918 0.345 0.047";
const LINE = "0.894 0.894 0.906";

export function buildPdf(doc: PdfDocument, footer = "Mangalli POS · Developed by 1garis Studio"): Buffer {
  const pages: string[][] = [];
  let ops: string[] = [];
  let y = 0;
  const text = (value: string, x: number, top: number, size: number, opts: { bold?: boolean; color?: string } = {}) =>
    ops.push(`BT /${opts.bold ? "F2" : "F1"} ${size} Tf ${opts.color ?? INK} rg ${x.toFixed(2)} ${(PAGE_H - top - size).toFixed(2)} Td ${hex(value)} Tj ET`);
  const rect = (x: number, top: number, w: number, h: number, color: string) => ops.push(`${color} rg ${x.toFixed(2)} ${(PAGE_H - top - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  const newPage = () => { ops = []; pages.push(ops); y = MARGIN; };
  const ensure = (height: number) => { if (y + height > PAGE_H - MARGIN - 24) { newPage(); return true; } return false; };
  const contentWidth = PAGE_W - MARGIN * 2;

  newPage();
  text(fit(doc.title, contentWidth, 18, true), MARGIN, y, 18, { bold: true });
  y += 26;
  if (doc.subtitle) { text(fit(doc.subtitle, contentWidth, 10), MARGIN, y, 10, { color: MUTED }); y += 16; }
  rect(MARGIN, y, 48, 2, ORANGE);
  y += 18;

  for (const section of doc.sections) {
    if (section.kind === "text") {
      if (section.heading) { ensure(40); text(section.heading, MARGIN, y, 12, { bold: true }); y += 20; }
      // Bungkus kata sederhana per baris.
      const words = section.text.split(/\s+/);
      let line = "";
      for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (width(next, 10) > contentWidth && line) { ensure(15); text(line, MARGIN, y, 10); y += 15; line = word; } else line = next;
      }
      if (line) { ensure(15); text(line, MARGIN, y, 10); y += 15; }
      y += 10;
      continue;
    }
    ensure(60);
    text(section.heading, MARGIN, y, 12, { bold: true });
    y += 20;
    if (section.kind === "kv") {
      for (const [label, value] of section.rows) {
        ensure(20);
        text(fit(label, contentWidth * 0.62, 10), MARGIN, y, 10);
        text(value, MARGIN + contentWidth - width(value, 10, true), y, 10, { bold: true });
        y += 14;
        rect(MARGIN, y, contentWidth, 0.6, LINE);
        y += 6;
      }
    } else {
      const total = section.columns.reduce((sum, column) => sum + (column.width ?? 1), 0);
      const widths = section.columns.map((column) => (contentWidth * (column.width ?? 1)) / total);
      const header = () => {
        rect(MARGIN, y - 4, contentWidth, 18, "0.957 0.957 0.961");
        let x = MARGIN;
        section.columns.forEach((column, index) => {
          const label = fit(column.header, widths[index] - 8, 9, true);
          text(label, column.align === "right" ? x + widths[index] - 4 - width(label, 9, true) : x + 4, y, 9, { bold: true, color: MUTED });
          x += widths[index];
        });
        y += 18;
      };
      header();
      section.rows.forEach((row, rowIndex) => {
        if (ensure(18)) header();
        if (rowIndex % 2 === 1) rect(MARGIN, y - 4, contentWidth, 17, "0.984 0.984 0.988");
        let x = MARGIN;
        section.columns.forEach((column, index) => {
          const value = fit(row[index] ?? "", widths[index] - 8, 9.5);
          text(value, column.align === "right" ? x + widths[index] - 4 - width(value, 9.5) : x + 4, y, 9.5);
          x += widths[index];
        });
        y += 17;
      });
      if (!section.rows.length) { text("Nothing in this period.", MARGIN + 4, y, 9.5, { color: MUTED }); y += 17; }
    }
    if (section.note) { ensure(16); text(fit(section.note, contentWidth, 8.5), MARGIN, y + 2, 8.5, { color: MUTED }); y += 16; }
    y += 14;
  }

  // Kaki halaman ditulis setelah jumlah halaman diketahui.
  pages.forEach((page, index) => {
    ops = page;
    rect(MARGIN, PAGE_H - MARGIN - 6, contentWidth, 0.6, LINE);
    text(footer, MARGIN, PAGE_H - MARGIN, 8, { color: MUTED });
    const label = `Page ${index + 1} of ${pages.length}`;
    text(label, PAGE_W - MARGIN - width(label, 8), PAGE_H - MARGIN, 8, { color: MUTED });
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
