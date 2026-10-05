// Terbitkan rilis aplikasi (migrasi 017). Dijalankan tim 1garis Studio di
// container produksi, yang punya DATABASE_URL dan kunci R2:
//
//   android:   tsx scripts/publish-release.ts android --apk /tmp/app.apk --code 22 --name 0.8.0 --notes-file /tmp/notes.txt [--min 22]
//   dashboard: tsx scripts/publish-release.ts dashboard --name "4 Oct 2026" --notes-file /tmp/notes.txt
//
// APK diunggah ke R2 (mangalli/android/...), lalu baris app_releases dibuat.
// Tablet hanya bisa memasang APK yang ditandatangani kunci rilis yang sama.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Pool } from "pg";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { apk: { type: "string" }, code: { type: "string" }, name: { type: "string" }, "notes-file": { type: "string" }, min: { type: "string" } },
});
const platform = positionals[0];
if (platform !== "android" && platform !== "dashboard") throw new Error("First argument must be android or dashboard.");
if (!values.name || !values["notes-file"]) throw new Error("--name and --notes-file are required.");
const notes = (await readFile(values["notes-file"], "utf8")).trim();
if (!notes) throw new Error("Release notes are empty.");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  if (platform === "dashboard") {
    const result = await pool.query<{ version_code: number }>(
      `INSERT INTO app_releases(platform, version_code, version_name, notes)
       SELECT 'dashboard', coalesce(max(version_code), 0) + 1, $1, $2 FROM app_releases WHERE platform = 'dashboard'
       RETURNING version_code`, [values.name, notes]);
    console.log(`Published dashboard release ${values.name} (#${result.rows[0].version_code}).`);
  } else {
    const code = Number(values.code);
    const min = values.min ? Number(values.min) : null;
    if (!values.apk || !Number.isInteger(code) || code < 1) throw new Error("--apk and a numeric --code are required.");
    if (min !== null && (!Number.isInteger(min) || min > code)) throw new Error("--min must be a version code no higher than --code.");
    const bytes = await readFile(values.apk);
    if (bytes.subarray(0, 2).toString() !== "PK") throw new Error("That file is not an APK.");
    const latest = (await pool.query<{ version_code: number }>("SELECT max(version_code) AS version_code FROM app_releases WHERE platform = 'android'")).rows[0]?.version_code;
    if (latest && code <= latest) throw new Error(`Version code must be higher than the published ${latest}.`);
    const { R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_PUBLIC_URL } = process.env;
    if (!R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_ENDPOINT || !R2_PUBLIC_URL) throw new Error("R2 is not configured.");
    const s3 = new S3Client({ region: "auto", endpoint: R2_ENDPOINT, credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY } });
    const key = `mangalli/android/mangalli-pos-${values.name.replace(/[^0-9A-Za-z.-]/g, "")}-${code}.apk`;
    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET, Key: key, Body: bytes, ContentType: "application/vnd.android.package-archive",
      CacheControl: "public, max-age=31536000, immutable", ContentDisposition: `attachment; filename="mangalli-pos-${values.name}.apk"`,
    }));
    const url = `${R2_PUBLIC_URL.replace(/\/+$/, "")}/${key}`;
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await pool.query(
      `INSERT INTO app_releases(platform, version_code, version_name, notes, apk_url, apk_sha256, apk_size, min_version_code)
       VALUES ('android', $1, $2, $3, $4, $5, $6, $7)`, [code, values.name, notes, url, sha256, bytes.length, min]);
    console.log(`Published Android ${values.name} (${code}) ${url} sha256 ${sha256}${min ? `, required below ${min}` : ""}.`);
  }
} finally {
  await pool.end();
}
