import { headers } from "next/headers";

import { requireWebOperator } from "@/server/auth";
import { requireStepUp } from "@/server/step-up";
import { exportOutlet } from "@/server/data-transfer";
import { pool } from "@/server/db";
import { jsonError } from "@/server/http";
import { enforceRateLimit, rateLimitKey } from "@/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Unduh semua data outlet (owner saja), lihat server/data-transfer.ts.
export async function GET() {
  try {
    const requestHeaders = await headers();
    const operator = await requireWebOperator(requestHeaders, ["owner"]);
    await requireStepUp(operator);
    await enforceRateLimit(pool, rateLimitKey("data-export", requestHeaders, operator.outletKey), 10, 3600);
    const { file, name } = await exportOutlet(operator);
    return new Response(new Uint8Array(file), {
      headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
    });
  } catch (error) {
    return jsonError(error);
  }
}
