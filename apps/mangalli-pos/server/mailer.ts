import "server-only";

import { randomBytes } from "node:crypto";
import { connect, type TLSSocket } from "node:tls";

// Pengirim email SMTP minimal untuk laporan harian Mangalli, tanpa dependensi.
// Hosting 1garis memakai akun notifikasi bersama (SMTP_HOST/PORT/USER/PASSWORD,
// sama dengan Piran Temu): Lark di port 465 dengan TLS langsung (STARTTLS tidak didukung; port apa pun dianggap
// TLS langsung). Isi dikirim base64 per bagian MIME, jadi tidak
// ada baris yang diawali titik atau melebihi batas panjang SMTP.

export type Mail = { to: string; subject: string; html: string; text: string; fromName?: string };

export function mailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD);
}

const encodeHeader = (value: string) => (/^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`);
const base64Lines = (value: string) => Buffer.from(value).toString("base64").replace(/.{76}/g, "$&\r\n");

function message(mail: Mail, from: string): string {
  const boundary = `mangalli-${randomBytes(12).toString("hex")}`;
  const domain = from.split("@")[1] ?? "1garis.id";
  return [
    `From: ${encodeHeader(mail.fromName ?? "Mangalli POS")} <${from}>`,
    `To: <${mail.to}>`,
    `Subject: ${encodeHeader(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomBytes(16).toString("hex")}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(mail.text),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(mail.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

// Membaca satu balasan SMTP utuh (baris terakhir berformat "250 ...").
function reader(socket: TLSSocket) {
  let buffer = "";
  const waiting: Array<{ resolve: (reply: string) => void; reject: (error: Error) => void }> = [];
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let match: RegExpMatchArray | null;
    while ((match = buffer.match(/^(?:\d{3}-[^\n]*\n)*\d{3} [^\n]*\n/))) {
      buffer = buffer.slice(match[0].length);
      waiting.shift()?.resolve(match[0]);
    }
  });
  const fail = (error: Error) => { while (waiting.length) waiting.shift()!.reject(error); };
  socket.on("error", fail);
  socket.on("close", () => fail(new Error("SMTP connection closed")));
  return () => new Promise<string>((resolve, reject) => waiting.push({ resolve, reject }));
}

export async function sendMail(mail: Mail): Promise<void> {
  const host = process.env.SMTP_HOST ?? "";
  const port = Number(process.env.SMTP_PORT ?? 465);
  const user = process.env.SMTP_USER ?? "";
  const password = process.env.SMTP_PASSWORD ?? "";
  if (!host || !user || !password) throw new Error("SMTP is not configured.");
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(mail.to)) throw new Error("Invalid recipient address.");

  const socket = connect({ host, port, servername: host });
  socket.setTimeout(30_000, () => socket.destroy(new Error("SMTP timeout")));
  const next = reader(socket);
  const expect = async (code: string, command?: string) => {
    if (command !== undefined) socket.write(`${command}\r\n`);
    const reply = await next();
    if (!reply.startsWith(code)) throw new Error(`SMTP ${command?.split(" ")[0] ?? "greeting"} failed: ${reply.trim().split("\n").pop()}`);
  };
  try {
    await expect("220");
    await expect("250", "EHLO mangalli.web.id");
    await expect("334", "AUTH LOGIN");
    await expect("334", Buffer.from(user).toString("base64"));
    await expect("235", Buffer.from(password).toString("base64"));
    await expect("250", `MAIL FROM:<${user}>`);
    await expect("250", `RCPT TO:<${mail.to}>`);
    await expect("354", "DATA");
    await expect("250", `${message(mail, user)}\r\n.`);
    socket.write("QUIT\r\n");
  } finally {
    socket.end();
  }
}
