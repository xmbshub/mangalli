import { ZodError } from "zod";

// Hasil server action dashboard, dibaca form lewat useActionState.
export type FormState = { ok: boolean; message: string; href?: string } | null;

// Header unduhan: header HTTP hanya boleh byte 0-255, jadi `filename` berisi
// versi ASCII dan nama asli (misalnya dengan "–") ada di `filename*`.
// Insiden 5 Okt 2026: PDF Ask Eline bernama "1 Oct 2026 – 4 Oct 2026" gagal
// diunduh dan browser menerima JSON galat.
export function attachment(name: string): string {
  const ascii = name.normalize("NFKD").replace(/[\u2013\u2014]/g, "-").replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "").trim() || "download";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly errors?: Record<string, string[]>,
  ) {
    super(message);
  }
}

export function jsonError(error: unknown): Response {
  if (error instanceof HttpError) {
    return Response.json(
      { message: error.message, ...(error.errors ? { errors: error.errors } : {}) },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    const errors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const key = issue.path.join(".") || "request";
      (errors[key] ??= []).push(issue.message);
    }
    return Response.json({ message: "The given data was invalid.", errors }, { status: 422 });
  }
  console.error(error);
  return Response.json({ message: "Internal server error." }, { status: 500 });
}
