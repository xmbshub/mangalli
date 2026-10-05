import { headers } from "next/headers";

import { requireWebOperator } from "@/server/auth";
import { requireStepUp } from "@/server/step-up";
import { importOutlet } from "@/server/data-transfer";
import { pool } from "@/server/db";
import { HttpError, jsonError } from "@/server/http";
import { enforceRateLimit, rateLimitKey } from "@/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 200 * 1024 * 1024;

// Impor berkas data ke outlet kosong (owner saja), lihat server/data-transfer.ts.
export async function POST(request: Request) {
  try {
    const requestHeaders = await headers();
    // Hanya dari halaman dashboard sendiri.
    const origin = requestHeaders.get("origin");
    if (origin && new URL(origin).host !== requestHeaders.get("host")) throw new HttpError(403, "Forbidden");
    const operator = await requireWebOperator(requestHeaders, ["owner"]);
    await requireStepUp(operator);
    await enforceRateLimit(pool, rateLimitKey("data-import", requestHeaders, operator.outletKey), 5, 3600);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) throw new HttpError(422, "Choose the .zip file you downloaded from Mangalli.");
    if (file.size > MAX_BYTES) throw new HttpError(422, "The file is too large.");
    const summary = await importOutlet(operator, Buffer.from(await file.arrayBuffer()));
    return Response.json(summary);
  } catch (error) {
    return jsonError(error);
  }
}
