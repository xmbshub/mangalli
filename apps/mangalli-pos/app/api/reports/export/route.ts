import { headers } from "next/headers";

import { reportPeriod } from "@/server/admin";
import { requireWebOperator } from "@/server/auth";
import { jsonError } from "@/server/http";
import { reportPack } from "@/server/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Daily paid sales as CSV for the owner's bookkeeping. Sales exclude tax and
// discounts; collected is what customers paid. Scoped to the signed-in
// operator's outlet like the Reports page.
export async function GET(request: Request) {
  try {
    const operator = await requireWebOperator(await headers(), ["owner", "manager"]);
    const params = new URL(request.url).searchParams;
    const period = reportPeriod(operator.timezone, params.get("range") ?? "30", params.get("from") ?? "", params.get("to") ?? "");
    const data = await reportPack(operator, period);
    const lines = [
      "date,orders,sales_before_discounts,discounts,sales,tax,collected,cash,digital,cost_of_items,gross_profit",
      ...data.daily.filter((day) => day.orders).map((day) =>
        [day.day, day.orders, day.gross, day.discounts, day.net, day.tax, day.collected, day.cash, day.digital, day.cost, day.profit].map((value) => (typeof value === "number" ? Math.round(value) : value)).join(",")),
    ];
    return new Response(`${lines.join("\n")}\n`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="mangalli-${operator.outletKey}-sales-${period.from}-to-${period.to}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
