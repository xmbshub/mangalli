import "server-only";

import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import { HttpError } from "./http";

function clientFingerprint(headers: Headers) {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const source = forwarded || headers.get("x-real-ip")?.trim() || `unknown:${headers.get("user-agent") ?? "none"}`;
  return createHash("sha256").update(source).digest("hex");
}

export function rateLimitKey(scope: string, headers: Headers, identity = "") {
  return createHash("sha256").update(`${scope}:${clientFingerprint(headers)}:${identity.toLowerCase()}`).digest("hex");
}

export async function enforceRateLimit(
  client: Pool | PoolClient,
  key: string,
  limit: number,
  windowSeconds: number,
) {
  const result = await client.query<{ hits: number }>(
    `INSERT INTO api_rate_limits(key,window_started_at,hits) VALUES ($1,now(),1)
     ON CONFLICT (key) DO UPDATE SET
       hits=CASE WHEN api_rate_limits.window_started_at <= now()-make_interval(secs => $2::int)
         THEN 1 ELSE api_rate_limits.hits+1 END,
       window_started_at=CASE WHEN api_rate_limits.window_started_at <= now()-make_interval(secs => $2::int)
         THEN now() ELSE api_rate_limits.window_started_at END,
       updated_at=now()
     RETURNING hits`,
    [key, windowSeconds],
  );
  if ((result.rows[0]?.hits ?? limit + 1) > limit) throw new HttpError(429, "Too many requests. Please try again shortly.");
}

// Batas tebakan per akun (bukan per IP), dihitung dari percobaan yang gagal saja.
// Selalu lewat pool sendiri: di dalam transaksi, hitungan ikut di-rollback.
export async function assertFailuresBelow(client: Pool | PoolClient, scope: string, identity: string, limit: number, windowSeconds: number) {
  const result = await client.query<{ hits: number }>(
    "SELECT hits FROM api_rate_limits WHERE key=$1 AND window_started_at > now()-make_interval(secs => $2::int)",
    [failureKey(scope, identity), windowSeconds]);
  if ((result.rows[0]?.hits ?? 0) >= limit) throw new HttpError(429, "Too many wrong attempts. Try again in 15 minutes.");
}

export async function recordFailure(client: Pool | PoolClient, scope: string, identity: string, windowSeconds: number) {
  await enforceRateLimit(client, failureKey(scope, identity), Number.MAX_SAFE_INTEGER, windowSeconds);
}

function failureKey(scope: string, identity: string) {
  return createHash("sha256").update(`failures:${scope}:${identity.toLowerCase()}`).digest("hex");
}
