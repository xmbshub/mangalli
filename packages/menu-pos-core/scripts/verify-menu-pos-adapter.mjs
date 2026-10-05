#!/usr/bin/env node

import {
  createMenuPosHttpAdapter,
  menuPosProviders,
  menuPosReadContractPassed,
  verifyMenuPosReadContract,
} from "../src/index.ts";

const usage = `Usage:
  MENU_POS_API_BASE_URL=https://pos.example.test/api \\
  MENU_POS_OUTLET_KEY=my-cafe \\
  MENU_POS_QR_TOKEN=kopi-t31 \\
  MENU_POS_API_TOKEN=server-token \\
  pnpm --filter @1garis/menu-pos-core verify:adapter

Optional env:
  MENU_POS_PROVIDER=mangalli-pos|external
  MENU_POS_QR_TOKEN=<active QR token>
`;

function requiredEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function optionalEnv(name) {
  return process.env[name]?.trim() || undefined;
}

try {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(usage);
    process.exit(0);
  }

  const provider = optionalEnv("MENU_POS_PROVIDER") || "mangalli-pos";
  const apiToken = optionalEnv("MENU_POS_API_TOKEN");

  if (!menuPosProviders.includes(provider)) {
    throw new Error(`MENU_POS_PROVIDER must be one of: ${menuPosProviders.join(", ")}.`);
  }

  const adapter = createMenuPosHttpAdapter({
    binding: {
      apiBaseUrl: requiredEnv("MENU_POS_API_BASE_URL").replace(/\/+$/, ""),
      ...(apiToken ? { apiToken } : {}),
      outletKey: requiredEnv("MENU_POS_OUTLET_KEY"),
      provider,
    },
  });
  const checks = await verifyMenuPosReadContract({
    adapter,
    outletKey: requiredEnv("MENU_POS_OUTLET_KEY"),
    qrToken: optionalEnv("MENU_POS_QR_TOKEN"),
  });
  const ok = menuPosReadContractPassed(checks);

  console.log(JSON.stringify({ checks, ok }, null, 2));
  process.exit(ok ? 0 : 1);
} catch (caught) {
  console.error(caught instanceof Error ? caught.message : "Menu POS adapter verification failed.");
  process.exit(1);
}
