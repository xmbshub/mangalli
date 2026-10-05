// Penjadwal email laporan harian (permintaan owner 4 Okt 2026). Instrumentasi
// hanya memicu endpoint internal tiap 5 menit lewat localhost; pekerjaannya
// berjalan di route handler biasa, karena modul server memakai "server-only"
// yang tidak boleh diimpor dari sini. Token diturunkan dari POS_SESSION_SECRET.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.DAILY_REPORT_ENABLED === "false") return;
  const secret = process.env.POS_SESSION_SECRET ?? "";
  if (secret.length < 16) return;
  // Web Crypto, bukan node:crypto: berkas ini juga dikompilasi untuk runtime Edge.
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode("mangalli:daily-report:cron")));
  const token = Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const port = process.env.PORT ?? "4107";
  const tick = () => {
    fetch(`http://127.0.0.1:${port}/api/daily-report/run`, { method: "POST", headers: { "x-mangalli-cron": token } })
      .catch(() => { /* server belum siap atau jaringan lokal sibuk: dicoba lagi 5 menit kemudian */ });
  };
  setTimeout(tick, 60_000);
  setInterval(tick, 5 * 60_000);
}
