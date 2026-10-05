import { query } from "@/server/db";
import { unsubscribeToken, validToken } from "@/server/daily-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Stop daily reports" link in the email. GET only shows a confirm button,
// because mail scanners open links on their own; POST does the change.
const page = (title: string, body: string) => new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | Mangalli POS</title></head>
<body style="margin:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b">
<main style="max-width:420px;margin:12vh auto;padding:28px;background:#fff;border:1px solid #e4e4e7;border-radius:16px">
<h1 style="margin:0 0 8px;font-size:20px;font-weight:500">${title}</h1>${body}</main></body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

function check(url: URL) {
  const user = url.searchParams.get("u") ?? "";
  const token = url.searchParams.get("t") ?? "";
  return /^\d+$/.test(user) && validToken(unsubscribeToken(user), token) ? user : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!check(url)) return page("Link expired", `<p style="color:#71717a;font-size:14px">This link isn't valid. Ask the outlet owner to turn off your daily report in Outlet settings.</p>`);
  return page("Stop daily reports?", `<p style="color:#71717a;font-size:14px;line-height:1.55">You won't get the end-of-day sales email any more. You can turn it back on in the dashboard under Outlet settings.</p>
<form method="post"><button style="margin-top:8px;padding:11px 18px;border:0;border-radius:12px;background:#ea580c;color:#fff;font-size:14px;cursor:pointer">Stop daily reports</button></form>`);
}

export async function POST(request: Request) {
  const user = check(new URL(request.url));
  if (!user) return page("Link expired", `<p style="color:#71717a;font-size:14px">This link isn't valid.</p>`);
  await query("UPDATE users SET daily_report_opt_out = true, updated_at = now() WHERE id = $1", [user]);
  return page("Daily reports stopped", `<p style="color:#71717a;font-size:14px;line-height:1.55">Done. To get them again, open the dashboard, go to Outlet settings, and switch your daily report back on.</p>`);
}
