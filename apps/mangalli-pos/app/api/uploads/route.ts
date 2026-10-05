import { headers } from "next/headers";

import { requireWebOperator } from "@/server/auth";
import { pool } from "@/server/db";
import { HttpError, jsonError } from "@/server/http";
import { mediaKinds, uploadOutletImage, type MediaKind } from "@/server/media";
import { enforceRateLimit, rateLimitKey } from "@/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Unggah gambar dari dashboard (owner/manager). Mengembalikan URL publik;
// form menyimpan URL itu seperti sebelumnya.
export async function POST(request: Request) {
  try {
    const requestHeaders = await headers();
    const operator = await requireWebOperator(requestHeaders, ["owner", "manager"]);
    await enforceRateLimit(pool, rateLimitKey("media-upload", requestHeaders, operator.outletKey), 60, 60);
    const form = await request.formData();
    const kind = String(form.get("kind") ?? "");
    const file = form.get("file");
    if (!mediaKinds.includes(kind as MediaKind)) throw new HttpError(422, "Unknown image type.");
    if (!(file instanceof File)) throw new HttpError(422, "Choose an image.");
    const url = await uploadOutletImage(operator.outletKey, kind as MediaKind, new Uint8Array(await file.arrayBuffer()));
    return Response.json({ url }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
