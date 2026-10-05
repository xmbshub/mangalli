import QRCode from "qrcode";
import { headers } from "next/headers";

import { requireWebOperator } from "@/server/auth";
import { query } from "@/server/db";
import { jsonError } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ token: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const operator = await requireWebOperator(await headers(), ["owner", "manager"]);
    const { token } = await context.params;
    const table = await query<{ table_code: string; menu_url: string | null }>(
      `SELECT t.table_code,o.menu_url FROM qr_tables t JOIN outlets o ON o.outlet_key=t.outlet_key
        WHERE t.qr_token=$1 AND t.outlet_key=$2 AND t.is_active=true`,
      [token, operator.outletKey],
    );
    if (!table.rows[0]) return Response.json({ message: "Active table not found." }, { status: 404 });
    // QR meja membuka situs menu digital outlet (layanan website). Tanpa situs
    // menu, QR tidak punya tujuan untuk pelanggan.
    if (!table.rows[0].menu_url) {
      return Response.json({ message: "Add the digital menu address in Outlet settings before downloading table QR codes." }, { status: 422 });
    }
    const publicMenuUrl = new URL(table.rows[0].menu_url);
    publicMenuUrl.searchParams.set("table", token);
    const svg = await QRCode.toString(publicMenuUrl.toString(), { type: "svg", errorCorrectionLevel: "H", margin: 2, width: 768 });
    return new Response(svg, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="mangalli-${table.rows[0].table_code}.svg"`,
        "Content-Type": "image/svg+xml; charset=utf-8",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
