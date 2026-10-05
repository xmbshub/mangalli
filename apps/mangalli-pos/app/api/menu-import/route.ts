import { headers } from "next/headers";

import { requireWebOperator } from "@/server/auth";
import { pool } from "@/server/db";
import { HttpError, jsonError } from "@/server/http";
import { imageType } from "@/server/media";
import { MAX_MENU_IMAGES, MAX_MENU_TEXT, readMenu } from "@/server/menu-import";
import { enforceRateLimit, rateLimitKey } from "@/server/rate-limit";
import { recordReport } from "@/server/support";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Eline membaca foto/teks menu dan mengembalikan draf untuk diperiksa owner.
// Tidak ada yang tersimpan di sini; penyimpanan lewat importMenuAction.
export async function POST(request: Request) {
  let outletKey: string | null = null;
  try {
    const requestHeaders = await headers();
    const operator = await requireWebOperator(requestHeaders, ["owner", "manager"]);
    outletKey = operator.outletKey;
    await enforceRateLimit(pool, rateLimitKey("menu-import", requestHeaders, operator.outletKey), 12, 3600);
    const form = await request.formData();
    const text = String(form.get("text") ?? "").slice(0, MAX_MENU_TEXT);
    const files = form.getAll("files").filter((file): file is File => file instanceof File && file.size > 0);
    if (files.length > MAX_MENU_IMAGES) throw new HttpError(422, `Use up to ${MAX_MENU_IMAGES} photos at a time.`);
    const images = [];
    for (const file of files) {
      if (file.size > MAX_IMAGE_BYTES) throw new HttpError(422, "Each photo must be 5 MB or smaller.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const type = imageType(bytes);
      if (!type) throw new HttpError(422, "Use JPG, PNG, or WebP photos. For a PDF, take a screenshot of each page.");
      images.push({ contentType: type.contentType, bytes });
    }
    return Response.json(await readMenu({ images, text }));
  } catch (error) {
    // Kegagalan membaca menu muncul di Support supaya tim bisa menindaklanjuti.
    if (outletKey && error instanceof HttpError && error.status >= 500) {
      await recordReport(pool, { outletKey, source: "system", category: "menu", fingerprint: `menu-import:${error.status}`,
        title: "Eline couldn't read an uploaded menu", message: error.message }).catch(() => undefined);
    }
    return jsonError(error);
  }
}
