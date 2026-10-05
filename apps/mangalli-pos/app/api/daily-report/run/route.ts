import { cronToken, runDailyReports, validToken } from "@/server/daily-report";
import { jsonError } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Called every 5 minutes by the scheduler in instrumentation.ts with a token
// derived from POS_SESSION_SECRET. Sends any daily reports that are due.
export async function POST(request: Request) {
  try {
    if (!validToken(cronToken(), request.headers.get("x-mangalli-cron") ?? "")) return Response.json({ message: "Forbidden" }, { status: 403 });
    return Response.json(await runDailyReports(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
