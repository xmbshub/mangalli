import QRCode from "qrcode";
import { headers } from "next/headers";

import { requireWebOperator } from "@/server/auth";
import { query } from "@/server/db";
import { jsonError } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

// Lembar QR siap cetak (A4, 6 per halaman) untuk semua meja aktif atau satu
// area. Setiap QR membuka menu digital outlet dengan token mejanya.
export async function GET(request: Request) {
  try {
    const operator = await requireWebOperator(await headers(), ["owner", "manager"]);
    const area = new URL(request.url).searchParams.get("area")?.trim() || null;
    const outlet = (await query<{ name: string; public_name: string | null; menu_url: string | null }>(
      "SELECT name,public_name,menu_url FROM outlets WHERE outlet_key=$1", [operator.outletKey])).rows[0];
    if (!outlet?.menu_url) return Response.json({ message: "Add the digital menu address in Outlet settings first." }, { status: 422 });
    const tables = (await query<{ table_code: string; table_label: string; table_area: string; qr_token: string }>(
      `SELECT table_code,table_label,table_area,qr_token FROM qr_tables
       WHERE outlet_key=$1 AND is_active=true AND ($2::text IS NULL OR table_area=$2) ORDER BY table_area,sort_order,table_code`,
      [operator.outletKey, area])).rows;
    const cards = await Promise.all(tables.map(async (table) => {
      const url = new URL(outlet.menu_url!);
      url.searchParams.set("table", table.qr_token);
      const svg = await QRCode.toString(url.toString(), { type: "svg", errorCorrectionLevel: "H", margin: 1 });
      return `<article><p class="brand">${escape(outlet.public_name || outlet.name)}</p><h2>${escape(table.table_label)}</h2><div class="qr">${svg}</div><p class="cta">Scan to see the menu and order</p><p class="code">${escape(table.table_area)} · ${escape(table.table_code)}</p></article>`;
    }));
    const title = `QR codes · ${outlet.public_name || outlet.name}${area ? ` · ${area}` : ""}`;
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#18181b;background:#f4f4f5}
.bar{position:sticky;top:0;display:flex;gap:12px;align-items:center;justify-content:space-between;padding:14px 20px;background:#fff;border-bottom:1px solid #e4e4e7}
.bar p{margin:0;font-size:14px;color:#71717a}.bar button{border:0;border-radius:12px;background:#ea580c;color:#fff;font:500 14px system-ui;padding:10px 18px;cursor:pointer}
main{display:grid;grid-template-columns:repeat(2,1fr);gap:0;max-width:210mm;margin:16px auto;background:#fff}
article{height:98mm;padding:8mm;border:1px dashed #d4d4d8;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;break-inside:avoid}
.brand{margin:0;font-size:12px;color:#71717a;letter-spacing:.04em;text-transform:uppercase}h2{margin:2mm 0 3mm;font-size:22px;font-weight:500}
.qr{width:52mm;height:52mm}.qr svg{width:100%;height:100%}.cta{margin:3mm 0 0;font-size:13px}.code{margin:1mm 0 0;font-size:11px;color:#a1a1aa}
@media print{body{background:#fff}.bar{display:none}main{margin:0;max-width:none}@page{size:A4;margin:0}}
</style></head><body><div class="bar"><p>${escape(title)} · ${tables.length} tables. Cut along the dashed lines.</p><button onclick="window.print()">Print</button></div>
<main>${cards.join("") || "<p style='padding:24px'>No active tables.</p>"}</main></body></html>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
