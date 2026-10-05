import "server-only";

export const config = {
  customAmountMax: Number(process.env.ANDROID_POS_CUSTOM_AMOUNT_MAX ?? 10_000_000),
  // Hanya pengisi awal form login lokal; produksi memakai akun pusat.
  defaultOutletKey: process.env.MENU_POS_DEFAULT_OUTLET_KEY?.trim() ?? "",
  identityProxyEnabled: process.env.IDENTITY_PROXY_ENABLED === "true",
};

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
