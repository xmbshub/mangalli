import { headers } from "next/headers";

import { assistantInput, assistantStream } from "@/server/assistant";
import { requireWebOperator } from "@/server/auth";
import { pool } from "@/server/db";
import { HttpError, jsonError } from "@/server/http";
import { enforceRateLimit, rateLimitKey } from "@/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Panel "Ask Eline" di dashboard. Semua peran boleh bertanya; data yang
// dipakai selalu milik outlet si penanya (lihat server/assistant.ts).
export async function POST(request: Request) {
  try {
    const requestHeaders = await headers();
    const operator = await requireWebOperator(requestHeaders);
    await enforceRateLimit(pool, rateLimitKey("assistant", requestHeaders, operator.id), 40, 3600);
    const input = assistantInput.parse(await request.json().catch(() => {
      throw new HttpError(400, "Invalid request.");
    }));
    return new Response(await assistantStream(operator, input), {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
    });
  } catch (error) {
    return jsonError(error);
  }
}
