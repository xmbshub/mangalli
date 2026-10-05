import { headers } from "next/headers";

import { requireWebOperator } from "@/server/auth";
import { query } from "@/server/db";
import { attachment, jsonError } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Download a report file made by Ask Eline. Only the person who asked for it,
// or an owner/manager of the same outlet, can download it; files expire after 7 days.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const operator = await requireWebOperator(await headers(), ["owner", "manager", "staff"]);
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ message: "Not found." }, { status: 404 });
    const file = (await query<{ name: string; mime: string; bytes: Buffer }>(
      `SELECT name, mime, bytes FROM assistant_files WHERE id = $1 AND outlet_key = $2 AND created_at > now() - interval '7 days'
          AND (created_by = $3 OR $4 IN ('owner', 'manager'))`, [id, operator.outletKey, operator.id, operator.role])).rows[0];
    if (!file) return Response.json({ message: "This file has expired or isn't yours." }, { status: 404 });
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "content-type": file.mime,
        "content-disposition": attachment(file.name),
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
