// Rumus laporan yang murni (tanpa database), supaya bisa dites langsung.
// Lihat server/reports.ts untuk asal angkanya.

export type PaidOrder = {
  id: string; channel: string; order_mode: string; payment_method: string | null;
  amount: string; discount: string; gross: string | null; cost: string | null; costed: string | null;
  day: string; hour: number; dow: number;
};

export type Money = { gross: number; discounts: number; net: number; tax: number; collected: number; cost: number; costedNet: number; orders: number };

const shiftDay = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

// Rentang sebelumnya dengan panjang sama, tepat sebelum rentang yang dipilih.
export function previousPeriod(period: { from: string; to: string }): { from: string; to: string } {
  const length = Math.round((Date.parse(period.to) - Date.parse(period.from)) / 86_400_000) + 1;
  return { from: shiftDay(period.from, -length), to: shiftDay(period.from, -1) };
}

// Per pesanan: bersih = kotor − diskon, pajak = dibayar − bersih.
export function sumMoney(rows: PaidOrder[]): Money {
  const total = { gross: 0, discounts: 0, net: 0, tax: 0, collected: 0, cost: 0, costedNet: 0, orders: rows.length };
  for (const row of rows) {
    const gross = Number(row.gross ?? 0);
    const discount = Number(row.discount);
    const amount = Number(row.amount);
    const net = Math.max(0, gross - discount);
    total.gross += gross;
    total.discounts += discount;
    total.net += net;
    total.collected += amount;
    total.tax += Math.max(0, amount - net);
    total.cost += Number(row.cost ?? 0);
    // Bagian penjualan yang harga modalnya diketahui, untuk menyebut cakupan HPP.
    total.costedNet += gross ? Number(row.costed ?? 0) * (net / gross) : 0;
  }
  return total;
}

// Perubahan dibanding rentang sebelumnya, dalam persen bulat. null bila tidak bisa dibandingkan.
export function change(now: number, before: number): number | null {
  if (!before) return null;
  return Math.round(((now - before) / Math.abs(before)) * 100);
}
