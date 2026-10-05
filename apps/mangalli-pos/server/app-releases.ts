import "server-only";

import type { Pool, PoolClient } from "pg";

import { pool, query } from "./db";

// Rilis aplikasi (migrasi 017). Rilis diterbitkan tim 1garis Studio lewat
// scripts/publish-release.ts; di sini hanya dibaca.
export type AppRelease = {
  version_code: number; version_name: string; notes: string; apk_url: string | null; apk_sha256: string | null;
  apk_size: string | null; min_version_code: number | null; published_at: Date;
};

export async function latestRelease(platform: "android" | "dashboard"): Promise<AppRelease | null> {
  const result = await query<AppRelease>(
    `SELECT version_code, version_name, notes, apk_url, apk_sha256, apk_size::text, min_version_code, published_at
       FROM app_releases WHERE platform = $1 ORDER BY version_code DESC LIMIT 1`, [platform]);
  return result.rows[0] ?? null;
}

// GET /api/android-pos/app-update: tanpa login (tidak ada data outlet), supaya
// tablet yang belum tersambung pun bisa mendapat versi terbaru.
export async function androidAppUpdate(): Promise<Response> {
  const release = await latestRelease("android");
  if (!release?.apk_url || !release.apk_sha256) return Response.json({ release: null });
  return Response.json({
    release: {
      versionCode: release.version_code, versionName: release.version_name, notes: release.notes, url: release.apk_url,
      sha256: release.apk_sha256, size: Number(release.apk_size ?? 0), minVersionCode: release.min_version_code ?? 0,
      publishedAt: release.published_at.toISOString(),
    },
  }, { headers: { "Cache-Control": "no-store" } });
}

// Header "0.8.0 (22)" dari tablet; nilai lain diabaikan.
export async function recordAppVersion(deviceId: string, header: string | null, client: Pool | PoolClient = pool) {
  const match = header?.trim().match(/^([0-9][0-9A-Za-z.\-]{0,30}) \((\d{1,9})\)$/);
  if (!match) return;
  await client.query("UPDATE android_pos_devices SET app_version = $1, app_version_code = $2 WHERE id = $3", [match[1], Number(match[2]), deviceId]);
}
