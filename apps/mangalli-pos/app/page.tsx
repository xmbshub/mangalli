import { redirect } from "next/navigation";

import { query } from "@/server/db";

export const dynamic = "force-dynamic";

// Mangalli adalah POS (Android dan dashboard). Menu pelanggan dilayani situs
// menu digital di layanan website (apps/sites) lewat API adapter. QR meja lama
// yang masih mengarah ke sini (?table=<token>) diteruskan ke situs menu outlet
// pemilik meja itu.
export default async function Home({ searchParams }: { searchParams: Promise<{ table?: string }> }) {
  const token = (await searchParams).table?.trim();
  if (token) {
    const result = await query<{ menu_url: string | null }>(
      `SELECT o.menu_url FROM qr_tables t JOIN outlets o ON o.outlet_key=t.outlet_key
        WHERE t.qr_token=$1 AND t.is_active=true AND o.is_active=true`,
      [token],
    );
    const menuUrl = result.rows[0]?.menu_url;
    if (menuUrl) {
      const target = new URL(menuUrl);
      target.searchParams.set("table", token);
      redirect(target.toString());
    }
  }
  redirect("/admin/dashboard");
}
