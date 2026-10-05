import "server-only";

import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { HttpError } from "./http";

// Gambar outlet (foto produk, logo, banner) disimpan di R2 yang sama dengan
// Studio, di jalur per outlet: mangalli/<outlet>/<jenis>/<uuid>.<ext>.
// Kunci R2 hanya ada di server; browser hanya menerima URL publiknya.
export const mediaKinds = ["product", "logo", "banner"] as const;
export type MediaKind = (typeof mediaKinds)[number];

const MAX_BYTES = 4 * 1024 * 1024;

let client: S3Client | null = null;

function r2() {
  const { R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_PUBLIC_URL } = process.env;
  if (!R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_ENDPOINT || !R2_PUBLIC_URL) {
    throw new HttpError(503, "Image upload isn't set up on this server yet. Paste an image link instead.");
  }
  client ??= new S3Client({ region: "auto", endpoint: R2_ENDPOINT, credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY } });
  return { client, bucket: R2_BUCKET, publicUrl: R2_PUBLIC_URL.replace(/\/+$/, "") };
}

// Jenis file dibaca dari isi berkas, bukan dari nama atau header browser.
export function imageType(bytes: Uint8Array): { contentType: string; extension: string } | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { contentType: "image/jpeg", extension: "jpg" };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { contentType: "image/png", extension: "png" };
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return { contentType: "image/webp", extension: "webp" };
  return null;
}

export async function uploadOutletImage(outletKey: string, kind: MediaKind, bytes: Uint8Array): Promise<string> {
  if (!bytes.length) throw new HttpError(422, "The file is empty.");
  if (bytes.length > MAX_BYTES) throw new HttpError(422, "Images must be 4 MB or smaller.");
  const type = imageType(bytes);
  if (!type) throw new HttpError(422, "Use a JPG, PNG, or WebP image.");
  const { client: s3, bucket, publicUrl } = r2();
  const key = `mangalli/${outletKey}/${kind}/${randomUUID()}.${type.extension}`;
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: bytes,
    ContentType: type.contentType,
    CacheControl: "public, max-age=31536000, immutable",
  }));
  return `${publicUrl}/${key}`;
}
