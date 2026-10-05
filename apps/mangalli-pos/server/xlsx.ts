// Penulis XLSX minimal tanpa dependensi untuk file laporan dari Ask Eline.
// Satu workbook berisi beberapa sheet; header tebal dan dibekukan, kolom uang
// memakai format "Rp" #,##0, lebar kolom disesuaikan isi. Zip dari server/zip.ts
// (STORE, tanpa kompresi), cukup untuk file kecil.
import { zip } from "./zip";

export type CellKind = "text" | "money" | "number" | "percent" | "date";
export type Sheet = { name: string; columns: Array<{ header: string; kind?: CellKind }>; rows: Array<Array<string | number | null>> };

const xml = (value: string) => value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!)
  // Karakter kontrol tidak sah di XML.
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

const columnName = (index: number) => {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
};

// Gaya: 0 biasa, 1 header, 2 uang, 3 angka, 4 persen, 5 tanggal (teks ISO tetap teks).
const styleFor: Record<CellKind, number> = { text: 0, money: 2, number: 3, percent: 4, date: 0 };

function sheetXml(sheet: Sheet): string {
  const widths = sheet.columns.map((column, index) => Math.min(60, Math.max(column.header.length,
    ...sheet.rows.map((row) => String(row[index] ?? "").length + (column.kind === "money" ? 5 : 0))) + 2));
  const cell = (value: string | number | null, ref: string, style: number) => {
    if (value === null || value === "") return "";
    if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
    return `<c r="${ref}" t="inlineStr" s="${style === 1 ? 1 : 0}"><is><t xml:space="preserve">${xml(String(value))}</t></is></c>`;
  };
  const header = `<row r="1">${sheet.columns.map((column, index) => cell(column.header, `${columnName(index)}1`, 1)).join("")}</row>`;
  const body = sheet.rows.map((row, rowIndex) => `<row r="${rowIndex + 2}">${row.map((value, index) =>
    cell(value, `${columnName(index)}${rowIndex + 2}`, styleFor[sheet.columns[index]?.kind ?? "text"])).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols>
<sheetData>${header}${body}</sheetData></worksheet>`;
}

const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;Rp&quot;\\ #,##0"/><numFmt numFmtId="165" formatCode="0%"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEA580C"/></patternFill></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// Nama sheet Excel: maks 31 karakter, tanpa []:*?/\ dan unik.
function sheetNames(sheets: Sheet[]): string[] {
  const used = new Set<string>();
  return sheets.map((sheet, index) => {
    let name = sheet.name.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || `Sheet${index + 1}`;
    while (used.has(name.toLowerCase())) name = `${name.slice(0, 28)} ${index + 1}`;
    used.add(name.toLowerCase());
    return name;
  });
}

export function buildXlsx(sheets: Sheet[]): Buffer {
  const names = sheetNames(sheets);
  const text = (value: string) => Buffer.from(value, "utf8");
  return zip([
    { name: "[Content_Types].xml", data: text(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${names.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`) },
    { name: "_rels/.rels", data: text(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: "xl/workbook.xml", data: text(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((name, index) => `<sheet name="${xml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`) },
    { name: "xl/_rels/workbook.xml.rels", data: text(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { name: "xl/styles.xml", data: text(styles) },
    ...sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data: text(sheetXml(sheet)) })),
  ]);
}
