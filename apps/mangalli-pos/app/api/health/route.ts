import { query } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await query("SELECT 1");
    return Response.json({ status: "ok", service: "mangalli-pos" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "unavailable", service: "mangalli-pos" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
