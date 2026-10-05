import "server-only";

import type { Pool, PoolClient } from "pg";
import { z } from "zod";

import { authenticateDevice, optionalStaffSession } from "./auth";
import { pool } from "./db";
import { HttpError } from "./http";
import { enforceRateLimit, rateLimitKey } from "./rate-limit";

export const reportCategories = ["crash", "error", "payment", "printer", "sync", "menu", "other"] as const;
export type ReportCategory = (typeof reportCategories)[number];

type ReportInput = {
  outletKey: string;
  source: "tablet" | "dashboard" | "system";
  category: ReportCategory;
  title: string;
  message?: string | null;
  context?: Record<string, unknown>;
  fingerprint?: string | null;
  reportedBy?: string | number | null;
  deviceId?: string | number | null;
};

// Satu pintu untuk semua laporan masalah. Laporan otomatis (crash, galat,
// pembayaran) membawa sidik: selama masih terbuka, kejadian berulang hanya
// menambah hitungan. Setiap laporan juga tercetak di log container supaya tim
// 1garis bisa menyapu semua outlet dengan `docker compose logs | grep support-report`.
export async function recordReport(client: Pick<Pool | PoolClient, "query">, input: ReportInput): Promise<string> {
  const title = input.title.trim().slice(0, 160) || "Problem";
  const message = input.message?.trim().slice(0, 4000) || null;
  const context = JSON.stringify(input.context ?? {}).slice(0, 12_000);
  console.warn(`[support-report] outlet=${input.outletKey} source=${input.source} category=${input.category} title=${JSON.stringify(title)}`);
  if (input.fingerprint) {
    const merged = await client.query<{ id: string }>(
      `UPDATE support_reports SET occurrences=occurrences+1, last_seen_at=now(), message=coalesce($3, message), context=$4::jsonb
        WHERE outlet_key=$1 AND fingerprint=$2 AND status='open' RETURNING id::text`,
      [input.outletKey, input.fingerprint, message, context],
    );
    if (merged.rows[0]) return merged.rows[0].id;
  }
  const created = await client.query<{ id: string }>(
    `INSERT INTO support_reports(outlet_key, source, category, title, message, context, fingerprint, reported_by, device_id)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
     ON CONFLICT (outlet_key, fingerprint) WHERE status = 'open' AND fingerprint IS NOT NULL
       DO UPDATE SET occurrences=support_reports.occurrences+1, last_seen_at=now()
     RETURNING id::text`,
    [input.outletKey, input.source, input.category, title, message, context, input.fingerprint ?? null, input.reportedBy ?? null, input.deviceId ?? null],
  );
  return created.rows[0].id;
}

const androidReport = z.object({
  category: z.enum(reportCategories),
  title: z.string().trim().min(1).max(160),
  message: z.string().trim().max(4000).nullish(),
  fingerprint: z.string().trim().max(200).nullish(),
  context: z.record(z.string().max(60), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()])).default({}),
});

// Tablet mengirim crash (setelah aplikasi dibuka lagi), sinkron yang ditolak,
// dan laporan manual kasir. Cukup token perangkat: crash bisa terjadi sebelum
// kasir masuk.
export async function androidProblemReport(request: Request) {
  const device = await authenticateDevice(request);
  const staff = await optionalStaffSession(request, device).catch(() => null);
  await enforceRateLimit(pool, rateLimitKey("android-report", request.headers, device.id), 20, 600);
  const input = androidReport.parse(await request.json().catch(() => {
    throw new HttpError(400, "Invalid JSON body.");
  }));
  if (Object.keys(input.context).length > 40) throw new HttpError(422, "Too much context.");
  const id = await recordReport(pool, {
    outletKey: device.outlet_key, source: "tablet", category: input.category, title: input.title, message: input.message,
    context: { ...input.context, device: device.label ?? device.device_key }, fingerprint: input.fingerprint ? `tablet:${device.id}:${input.fingerprint}` : null,
    reportedBy: staff?.user_id ?? null, deviceId: device.id,
  });
  return Response.json({ id: Number(id) }, { status: 201 });
}
