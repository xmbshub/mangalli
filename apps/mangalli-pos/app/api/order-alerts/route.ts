import { headers } from "next/headers";

import { orderAlerts } from "@/server/admin";
import { requireWebOperator } from "@/server/auth";
import { jsonError } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Polled by the dashboard to play a sound for new digital menu orders.
// Scoped to the signed-in operator's outlet; cashiers and up only.
export async function GET(request: Request) {
  try {
    const operator = await requireWebOperator(await headers(), ["owner", "manager", "staff"]);
    const after = new URL(request.url).searchParams.get("after");
    return Response.json(await orderAlerts(operator, after), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
