import "server-only";

import { timingSafeEqual } from "node:crypto";
import { compare, hash } from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import type { Pool, PoolClient } from "pg";

import { config, requiredEnv } from "./config";
import { pool, query } from "./db";
import { HttpError } from "./http";
import { opaqueToken, sha256, type Device, type StaffSession } from "./pos";
import { assertFailuresBelow, recordFailure } from "./rate-limit";

export type Operator = {
  id: string;
  // Cabang yang sedang dibuka (cookie mangalli_outlet, diverifikasi tiap request).
  outletKey: string;
  // Cabang asal akun (users.outlet_key).
  homeOutletKey: string;
  name: string;
  email: string;
  role: "owner" | "manager" | "staff" | "viewer";
  // Zona waktu outlet untuk batas hari dan jam di dashboard.
  timezone: string;
};

const operatorRoles = ["owner", "manager", "staff"] as const;
const sessionCookie = "mangalli_pos_session";
export const outletCookie = "mangalli_outlet";

function constantTimeMatch(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length > 0 && expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

export function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() || null : null;
}

export function authorizeSetupToken(request: Request): void {
  const expected = process.env.ANDROID_POS_SETUP_TOKEN?.trim() ?? "";
  if (!expected) throw new HttpError(503, "Android POS setup token is not configured.");
  const actual = bearerToken(request) ?? "";
  if (!constantTimeMatch(expected, actual)) throw new HttpError(401, "Unauthorized");
}

export async function authenticateDevice(request: Request, client: Pool | PoolClient = pool): Promise<Device> {
  const token = bearerToken(request);
  if (!token) throw new HttpError(401, "Unauthorized");
  const result = await client.query<Device & { token_digest: string; revoked_at: Date | null }>(
    `SELECT id::text, outlet_key, device_key, label, token_hash, token_digest, last_seen_at, created_at, revoked_at
       FROM android_pos_devices WHERE token_digest = $1`,
    [sha256(token)],
  );
  const device = result.rows[0];
  if (!device || device.revoked_at || !(await compare(token, device.token_hash))) throw new HttpError(401, "Unauthorized");
  return device;
}

export async function authenticateStaffSession(
  request: Request,
  device: Device,
  client: Pool | PoolClient = pool,
): Promise<StaffSession> {
  const token = request.headers.get("x-android-staff-token")?.trim();
  if (!token) throw new HttpError(401, "Staff session is required.");
  const result = await client.query<StaffSession & { token_digest: string; revoked_at: Date | null; user_active: boolean; device_id: string }>(
    `SELECT s.id::text, s.user_id::text, s.device_id::text, s.outlet_key, s.token_hash, s.token_digest,
            s.last_seen_at, s.revoked_at, u.name AS user_name, u.email AS user_email,
            m.pos_role, u.is_active AS user_active
       FROM android_pos_staff_sessions s
       JOIN users u ON u.id = s.user_id
       JOIN outlet_members m ON m.user_id = s.user_id AND m.outlet_key = s.outlet_key
      WHERE s.device_id = $1 AND s.outlet_key = $2 AND s.token_digest = $3`,
    [device.id, device.outlet_key, sha256(token)],
  );
  const session = result.rows[0];
  if (
    !session || session.revoked_at || !session.user_active ||
    !operatorRoles.includes(session.pos_role) || !(await compare(token, session.token_hash))
  ) {
    throw new HttpError(401, "Unauthorized");
  }
  await client.query("UPDATE android_pos_staff_sessions SET last_seen_at = now(), updated_at = now() WHERE id = $1", [session.id]);
  return session;
}

export async function optionalStaffSession(request: Request, device: Device, client: Pool | PoolClient = pool) {
  return request.headers.get("x-android-staff-token") ? authenticateStaffSession(request, device, client) : null;
}

export async function issueDevice(
  client: PoolClient,
  input: { outletKey: string; deviceKey: string; label?: string | null },
) {
  const outlet = await client.query("SELECT 1 FROM outlets WHERE outlet_key = $1 AND is_active = true", [input.outletKey]);
  if (!outlet.rowCount) throw new HttpError(422, "The given data was invalid.", { outletKey: ["The outlet was not found or is inactive."] });
  const token = opaqueToken("mpos_");
  const tokenHash = await hash(token, 12);
  const result = await client.query<Device>(
    `INSERT INTO android_pos_devices(outlet_key, device_key, label, token_digest, token_hash, last_seen_at)
     VALUES ($1,$2,$3,$4,$5,now())
     ON CONFLICT (outlet_key, device_key) DO UPDATE SET
       label = EXCLUDED.label, token_digest = EXCLUDED.token_digest, token_hash = EXCLUDED.token_hash,
       last_seen_at = now(), revoked_at = NULL, updated_at = now()
     RETURNING id::text, outlet_key, device_key, label, token_hash, last_seen_at, created_at`,
    [input.outletKey, input.deviceKey, input.label ?? null, sha256(token), tokenHash],
  );
  return { device: result.rows[0], token };
}

export async function verifyStaffCredentials(
  client: Pool | PoolClient,
  input: { outletKey: string; email: string; password: string },
) {
  const result = await client.query<{
    id: string; name: string; email: string; password_hash: string; pos_role: "owner" | "manager" | "staff";
  }>(
    `SELECT u.id::text, u.name, u.email, u.password_hash, m.pos_role
       FROM users u JOIN outlet_members m ON m.user_id = u.id AND m.outlet_key = $2
      WHERE lower(u.email) = lower($1) AND u.is_active = true AND m.pos_role = ANY($3::text[])`,
    [input.email, input.outletKey, operatorRoles],
  );
  // Password minimal 6 karakter, jadi tebakan dibatasi per akun: 10 gagal per 15 menit.
  const account = `${input.outletKey}:${input.email}`;
  await assertFailuresBelow(pool, "login", account, 10, 900);
  const user = result.rows[0];
  if (!user || !(await compare(input.password, user.password_hash))) {
    await recordFailure(pool, "login", account, 900);
    throw new HttpError(422, "The given data was invalid.", { email: ["Invalid email or password for this outlet."] });
  }
  return user;
}

export async function issueStaffSession(client: PoolClient, device: Device, user: Awaited<ReturnType<typeof verifyStaffCredentials>>) {
  const token = opaqueToken("mpos_staff_");
  const tokenHash = await hash(token, 12);
  const result = await client.query<StaffSession>(
    `INSERT INTO android_pos_staff_sessions(device_id, user_id, outlet_key, token_digest, token_hash, last_seen_at)
     VALUES ($1,$2,$3,$4,$5,now())
     ON CONFLICT (device_id, user_id) DO UPDATE SET
       outlet_key = EXCLUDED.outlet_key, token_digest = EXCLUDED.token_digest, token_hash = EXCLUDED.token_hash,
       last_seen_at = now(), revoked_at = NULL, updated_at = now()
     RETURNING id::text, user_id::text, outlet_key, token_hash, last_seen_at,
       $6::text AS user_name, $7::text AS user_email, $8::text AS pos_role`,
    [device.id, user.id, device.outlet_key, sha256(token), tokenHash, user.name, user.email, user.pos_role],
  );
  return { session: result.rows[0], token };
}

export function devicePayload(device: Device) {
  return {
    id: Number(device.id), deviceKey: device.device_key, label: device.label, outletKey: device.outlet_key,
    lastSeenAt: device.last_seen_at?.toISOString() ?? null, registeredAt: device.created_at.toISOString(),
  };
}

export function permissionsForRole(role: string): string[] {
  if (role === "owner") return ["orders.manage", "payments.settle", "bills.manage", "products.read", "shifts.manage"];
  if (role === "manager") return ["orders.manage", "payments.settle", "bills.manage", "products.read", "shifts.manage"];
  if (role === "staff") return ["orders.manage", "payments.settle", "bills.manage", "products.read"];
  return ["products.read"];
}

export function staffSessionPayload(session: StaffSession) {
  return {
    id: Number(session.id), outletKey: session.outlet_key,
    staff: { id: Number(session.user_id), name: session.user_name, email: session.user_email, posRole: session.pos_role },
    permissions: permissionsForRole(session.pos_role),
  };
}

function cookieValue(headers: Headers, name: string) {
  const match = headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function sessionSecret() {
  return new TextEncoder().encode(requiredEnv("POS_SESSION_SECRET"));
}

export async function createOperatorSession(operator: Omit<Operator, "timezone" | "homeOutletKey">) {
  return new SignJWT({ outletKey: operator.outletKey, role: operator.role, name: operator.name, email: operator.email })
    .setProtectedHeader({ alg: "HS256" }).setSubject(operator.id).setIssuedAt().setExpirationTime("12h").sign(sessionSecret());
}

// Operator di cabang yang diminta bila ia anggota cabang itu (outlet_members
// hanya memuat cabang dalam brand yang sama); selain itu cabang asalnya.
async function operatorById(id: string, requestedOutlet: string | null): Promise<Operator> {
  const load = (outlet: string | null) => query<{ id: string; outlet_key: string; home: string; name: string; email: string; pos_role: Operator["role"]; timezone: string }>(
    `SELECT u.id::text, m.outlet_key, u.outlet_key AS home, u.name, u.email, m.pos_role, o.timezone
       FROM users u JOIN outlet_members m ON m.user_id = u.id JOIN outlets o ON o.outlet_key = m.outlet_key
      WHERE u.id = $1 AND u.is_active = true AND o.is_active AND m.outlet_key = coalesce($2, u.outlet_key)`,
    [id, outlet],
  );
  let row = requestedOutlet ? (await load(requestedOutlet)).rows[0] : undefined;
  row ??= (await load(null)).rows[0];
  if (!row?.outlet_key) throw new HttpError(401, "Unauthorized");
  return { id: row.id, outletKey: row.outlet_key, homeOutletKey: row.home, name: row.name, email: row.email, role: row.pos_role, timezone: row.timezone };
}

export async function requireWebOperator(headers: Headers, roles: Operator["role"][] = ["owner", "manager", "staff", "viewer"]): Promise<Operator> {
  let operator: Operator;
  if (config.identityProxyEnabled) {
    const expected = process.env.IDENTITY_PROXY_SECRET?.trim() ?? "";
    const received = headers.get("x-1garis-proxy")?.trim() ?? "";
    if (expected.length < 32 || !constantTimeMatch(expected, received)) throw new HttpError(403, "Forbidden");
    const externalId = headers.get("x-1garis-user")?.trim();
    if (!externalId || !/^\d+$/.test(externalId)) throw new HttpError(401, "Unauthorized");
    operator = await operatorById(externalId, cookieValue(headers, outletCookie));
  } else {
    const token = cookieValue(headers, sessionCookie);
    if (!token) throw new HttpError(401, "Unauthorized");
    try {
      const { payload } = await jwtVerify(token, sessionSecret(), { algorithms: ["HS256"] });
      if (!payload.sub) throw new Error("missing subject");
      operator = await operatorById(payload.sub, cookieValue(headers, outletCookie));
    } catch {
      throw new HttpError(401, "Unauthorized");
    }
  }
  if (!roles.includes(operator.role)) throw new HttpError(403, "Forbidden");
  return operator;
}
