export const menuPosProviders = ["mangalli-pos", "external"] as const;
export const orderModes = ["dinein", "takeaway"] as const;
export const restaurantOrderStatuses = [
  "pending_payment",
  "new",
  "accepted",
  "preparing",
  "ready",
  "completed",
  "cancelled",
] as const;

export type MenuPosProvider = (typeof menuPosProviders)[number];
export type OrderMode = (typeof orderModes)[number];
export type RestaurantOrderStatus = (typeof restaurantOrderStatuses)[number];

export type MenuPosBinding = {
  adminUrl?: string;
  apiBaseUrl: string;
  apiToken?: string;
  outletKey: string;
  provider: MenuPosProvider;
  publicUrl?: string;
};

export type PublicMenuPosConfig = {
  hasMenuPos: boolean;
  provider: MenuPosProvider;
  publicUrl: string | null;
};

export type MenuPosTableContext = {
  outletKey: string;
  qrToken: string;
  tableCode: string;
  tableLabel: string;
};

export type MenuPosItem = {
  category?: string | null;
  description?: string | null;
  id: string;
  imageUrl?: string | null;
  isAvailable: boolean;
  name: string;
  priceLabel: string;
  sortOrder?: number | null;
};

export type MenuPosOrderItemInput = {
  menuItemId: string;
  note?: string | null;
  quantity: number;
};

export type MenuPosStaffOrderLine = {
  name: string;
  note?: string | null;
  priceLabel?: string | null;
  quantity: number;
};

export type MenuPosCreateOrderInput = {
  customerName?: string | null;
  items: MenuPosOrderItemInput[];
  mode: OrderMode;
  outletKey: string;
  pickupName?: string | null;
  table?: MenuPosTableContext | null;
};

export type MenuPosOrderSummary = {
  code: string;
  createdAt?: string | null;
  id: string;
  mode: OrderMode;
  publicToken: string;
  status: RestaurantOrderStatus;
  tableLabel?: string | null;
};

export type MenuPosStaffOrder = MenuPosOrderSummary & {
  customerName?: string | null;
  lines: MenuPosStaffOrderLine[];
  paymentStatus?: string | null;
  pickupName?: string | null;
  totalPriceLabel?: string | null;
};

export type MenuPosOpeningHour = {
  closeTime?: string | null;
  day?: string | null;
  isOpen: boolean;
  key: string;
  openTime?: string | null;
};

export type MenuPosOutletProfileInput = {
  address?: string | null;
  bannerImageUrl?: string | null;
  isActive?: boolean;
  logoImageUrl?: string | null;
  name?: string | null;
  openingHours?: MenuPosOpeningHour[] | null;
  phone?: string | null;
  publicName?: string | null;
  tagline?: string | null;
};

export type MenuPosOutletProfile = Required<Pick<MenuPosBinding, "outletKey">> & {
  address?: string | null;
  bannerImageUrl?: string | null;
  isActive: boolean;
  logoImageUrl?: string | null;
  name: string;
  openingHours: MenuPosOpeningHour[];
  phone?: string | null;
  publicName?: string | null;
  tagline?: string | null;
};

export type MenuPosAdapter = {
  createOrder(input: MenuPosCreateOrderInput): Promise<MenuPosOrderSummary>;
  getOrderStatus(publicToken: string): Promise<MenuPosOrderSummary | null>;
  getOutletMenu(outletKey: string): Promise<MenuPosItem[]>;
  listOrders(outletKey: string): Promise<MenuPosStaffOrder[]>;
  resolveQrTable(qrToken: string): Promise<MenuPosTableContext | null>;
  syncOutletProfile(outletKey: string, input: MenuPosOutletProfileInput): Promise<MenuPosOutletProfile>;
  transitionOrder(orderId: string, nextStatus: RestaurantOrderStatus): Promise<MenuPosOrderSummary>;
};

export type MenuPosHttpAdapterOptions = {
  binding: MenuPosBinding;
  fetchFn?: typeof fetch;
};

export type MenuPosReadContractCheckName = "outlet_menu" | "qr_table";

export type MenuPosReadContractCheck = {
  details?: Record<string, unknown>;
  message: string;
  name: MenuPosReadContractCheckName;
  ok: boolean;
};

export type VerifyMenuPosReadContractInput = {
  adapter: Pick<MenuPosAdapter, "getOutletMenu" | "resolveQrTable">;
  outletKey: string;
  qrToken?: string | null;
};

const orderStatusTransitions: Record<RestaurantOrderStatus, RestaurantOrderStatus[]> = {
  accepted: ["preparing", "ready", "completed", "cancelled"],
  cancelled: [],
  completed: [],
  new: ["accepted", "preparing", "cancelled"],
  pending_payment: [],
  preparing: ["ready", "completed", "cancelled"],
  ready: ["completed", "cancelled"],
};

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function cleanUrl(value: unknown): string | null {
  return cleanString(value)?.replace(/\/+$/, "") ?? null;
}

function cleanNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isOrderMode(value: unknown): value is OrderMode {
  return (orderModes as readonly unknown[]).includes(value);
}

export function isRestaurantOrderStatus(value: unknown): value is RestaurantOrderStatus {
  return (restaurantOrderStatuses as readonly unknown[]).includes(value);
}

export function canTransitionRestaurantOrderStatus(
  currentStatus: RestaurantOrderStatus,
  nextStatus: RestaurantOrderStatus,
): boolean {
  return currentStatus === nextStatus || orderStatusTransitions[currentStatus].includes(nextStatus);
}

export function parseMenuPosBindings(value: unknown): Record<string, MenuPosBinding> {
  let source: unknown = value;

  if (typeof value === "string") {
    try {
      source = JSON.parse(value);
    } catch {
      return {};
    }
  }

  if (!isRecord(source)) {
    return {};
  }

  const bindings: Record<string, MenuPosBinding> = {};

  for (const [key, rawBinding] of Object.entries(source)) {
    if (!isRecord(rawBinding)) {
      continue;
    }

    const apiBaseUrl = cleanUrl(rawBinding.apiBaseUrl);
    const outletKey = cleanString(rawBinding.outletKey);
    const provider = cleanString(rawBinding.provider);

    if (!apiBaseUrl || !outletKey || !isMenuPosProvider(provider)) {
      continue;
    }

    const adminUrl = cleanUrl(rawBinding.adminUrl);
    const apiToken = cleanString(rawBinding.apiToken);
    const publicUrl = cleanUrl(rawBinding.publicUrl);

    bindings[key] = {
      ...(adminUrl ? { adminUrl } : {}),
      apiBaseUrl,
      ...(apiToken ? { apiToken } : {}),
      outletKey,
      provider,
      ...(publicUrl ? { publicUrl } : {}),
    };
  }

  return bindings;
}

export function publicMenuPosConfig(binding: MenuPosBinding | null | undefined): PublicMenuPosConfig {
  if (!binding) {
    return {
      hasMenuPos: false,
      provider: "external",
      publicUrl: null,
    };
  }

  return {
    hasMenuPos: true,
    provider: binding.provider,
    publicUrl: binding.publicUrl || null,
  };
}

export function resolveMenuPosBinding(
  bindings: Record<string, MenuPosBinding>,
  candidates: Array<string | null | undefined>,
): MenuPosBinding | null {
  for (const candidate of candidates) {
    const key = cleanString(candidate);

    if (key && bindings[key]) {
      return bindings[key];
    }
  }

  return null;
}

export function validateMenuPosCreateOrderInput(input: MenuPosCreateOrderInput): string[] {
  const errors: string[] = [];

  if (!cleanString(input.outletKey)) {
    errors.push("outletKey is required.");
  }

  if (!isOrderMode(input.mode)) {
    errors.push("mode must be dinein or takeaway.");
  }

  if (input.mode === "dinein" && !input.table?.qrToken) {
    errors.push("dinein orders require an active QR table.");
  }

  if (input.mode === "takeaway" && !cleanString(input.pickupName || input.customerName)) {
    errors.push("takeaway orders require pickupName or customerName.");
  }

  if (!input.items.length) {
    errors.push("at least one order item is required.");
  }

  for (const [index, item] of input.items.entries()) {
    if (!cleanString(item.menuItemId)) {
      errors.push(`items.${index}.menuItemId is required.`);
    }

    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
      errors.push(`items.${index}.quantity must be between 1 and 99.`);
    }
  }

  return errors;
}

export function createMenuPosHttpAdapter(options: MenuPosHttpAdapterOptions): MenuPosAdapter {
  const fetchFn = options.fetchFn ?? fetch;
  const binding = options.binding;

  return {
    createOrder(input) {
      return menuPosRequest(binding, "/orders", {
        body: JSON.stringify(input),
        fetchFn,
        method: "POST",
        parser: parseOrderSummary,
      });
    },
    getOrderStatus(publicToken) {
      return menuPosRequest(binding, `/orders/public/${encodeURIComponent(publicToken)}`, {
        fetchFn,
        method: "GET",
        parser: (value) => (value === null ? null : parseOrderSummary(value)),
      });
    },
    getOutletMenu(outletKey) {
      return menuPosRequest(binding, `/outlets/${encodeURIComponent(outletKey)}/menu`, {
        fetchFn,
        method: "GET",
        parser: parseMenuItems,
      });
    },
    listOrders(outletKey) {
      return menuPosRequest(binding, `/outlets/${encodeURIComponent(outletKey)}/orders`, {
        fetchFn,
        method: "GET",
        parser: parseStaffOrders,
      });
    },
    resolveQrTable(qrToken) {
      return menuPosRequest(binding, `/qr-tables/${encodeURIComponent(qrToken)}`, {
        fetchFn,
        method: "GET",
        parser: (value) => (value === null ? null : parseTableContext(value)),
      });
    },
    syncOutletProfile(outletKey, input) {
      return menuPosRequest(binding, `/outlets/${encodeURIComponent(outletKey)}/profile`, {
        body: JSON.stringify(input),
        fetchFn,
        method: "PATCH",
        parser: parseOutletProfile,
      });
    },
    transitionOrder(orderId, nextStatus) {
      return menuPosRequest(binding, `/orders/${encodeURIComponent(orderId)}/status`, {
        body: JSON.stringify({ status: nextStatus }),
        fetchFn,
        method: "POST",
        parser: parseOrderSummary,
      });
    },
  };
}

export async function verifyMenuPosReadContract(
  input: VerifyMenuPosReadContractInput,
): Promise<MenuPosReadContractCheck[]> {
  const checks: MenuPosReadContractCheck[] = [];

  try {
    const menu = await input.adapter.getOutletMenu(input.outletKey);

    checks.push({
      details: {
        itemCount: menu.length,
      },
      message: menu.length
        ? `Menu endpoint returned ${menu.length} item(s).`
        : "Menu endpoint returned no items.",
      name: "outlet_menu",
      ok: menu.length > 0,
    });
  } catch (caught) {
    checks.push({
      message: errorMessage(caught),
      name: "outlet_menu",
      ok: false,
    });
  }

  const qrToken = cleanString(input.qrToken);

  if (!qrToken) {
    checks.push({
      message: "QR table check skipped because no qrToken was provided.",
      name: "qr_table",
      ok: true,
    });

    return checks;
  }

  try {
    const table = await input.adapter.resolveQrTable(qrToken);

    checks.push({
      details: table
        ? {
            outletKey: table.outletKey,
            tableCode: table.tableCode,
            tableLabel: table.tableLabel,
          }
        : undefined,
      message: table
        ? `QR token resolved to ${table.tableLabel}.`
        : "QR token did not resolve to an active table.",
      name: "qr_table",
      ok: Boolean(table),
    });
  } catch (caught) {
    checks.push({
      message: errorMessage(caught),
      name: "qr_table",
      ok: false,
    });
  }

  return checks;
}

export function menuPosReadContractPassed(checks: MenuPosReadContractCheck[]) {
  return checks.length > 0 && checks.every((check) => check.ok);
}

function isMenuPosProvider(value: unknown): value is MenuPosProvider {
  return (menuPosProviders as readonly unknown[]).includes(value);
}

function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : "Unknown Menu POS adapter error.";
}

async function menuPosRequest<T>(
  binding: MenuPosBinding,
  path: string,
  options: {
    body?: string;
    fetchFn: typeof fetch;
    method: "GET" | "PATCH" | "POST";
    parser: (value: unknown) => T;
  },
): Promise<T> {
  const response = await options.fetchFn(`${binding.apiBaseUrl}${path}`, {
    body: options.body,
    headers: {
      ...(binding.apiToken ? { authorization: `Bearer ${binding.apiToken}` } : {}),
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    method: options.method,
  });

  if (response.status === 404) {
    return options.parser(null);
  }

  if (!response.ok) {
    throw new Error(`Menu POS request failed with status ${response.status}.`);
  }

  return options.parser(await response.json());
}

function parseMenuItems(value: unknown): MenuPosItem[] {
  const source = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.items)
      ? value.items
      : [];

  return source.map(parseMenuItem).filter((item): item is MenuPosItem => Boolean(item));
}

function parseMenuItem(value: unknown): MenuPosItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = cleanString(value.id);
  const name = cleanString(value.name);
  const priceLabel = cleanString(value.priceLabel);

  if (!id || !name || !priceLabel) {
    return null;
  }

  return {
    category: cleanString(value.category),
    description: cleanString(value.description),
    id,
    imageUrl: cleanUrl(value.imageUrl),
    isAvailable: value.isAvailable !== false,
    name,
    priceLabel,
    sortOrder: cleanNumber(value.sortOrder),
  };
}

function parseOrderSummary(value: unknown): MenuPosOrderSummary {
  if (!isRecord(value)) {
    throw new Error("Menu POS order response is invalid.");
  }

  const id = cleanString(value.id);
  const code = cleanString(value.code);
  const mode = cleanString(value.mode);
  const publicToken = cleanString(value.publicToken);
  const status = cleanString(value.status);

  if (!id || !code || !isOrderMode(mode) || !publicToken || !isRestaurantOrderStatus(status)) {
    throw new Error("Menu POS order response is invalid.");
  }

  return {
    code,
    createdAt: cleanString(value.createdAt),
    id,
    mode,
    publicToken,
    status,
    tableLabel: cleanString(value.tableLabel),
  };
}

function parseStaffOrders(value: unknown): MenuPosStaffOrder[] {
  const source = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.orders)
      ? value.orders
      : [];

  return source.map(parseStaffOrder).filter((order): order is MenuPosStaffOrder => Boolean(order));
}

function parseStaffOrder(value: unknown): MenuPosStaffOrder | null {
  if (!isRecord(value)) {
    return null;
  }

  const summary = parseOrderSummary(value);
  const sourceLines = Array.isArray(value.lines) ? value.lines : [];

  return {
    ...summary,
    customerName: cleanString(value.customerName),
    lines: sourceLines.map(parseStaffOrderLine).filter((line): line is MenuPosStaffOrderLine => Boolean(line)),
    paymentStatus: cleanString(value.paymentStatus),
    pickupName: cleanString(value.pickupName),
    totalPriceLabel: cleanString(value.totalPriceLabel),
  };
}

function parseStaffOrderLine(value: unknown): MenuPosStaffOrderLine | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = cleanString(value.name);
  const quantity = cleanNumber(value.quantity);

  if (!name || !quantity || quantity < 1) {
    return null;
  }

  return {
    name,
    note: cleanString(value.note),
    priceLabel: cleanString(value.priceLabel),
    quantity,
  };
}

function parseOpeningHours(value: unknown): MenuPosOpeningHour[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(parseOpeningHour).filter((hour): hour is MenuPosOpeningHour => Boolean(hour));
}

function parseOpeningHour(value: unknown): MenuPosOpeningHour | null {
  if (!isRecord(value)) {
    return null;
  }

  const key = cleanString(value.key);

  if (!key) {
    return null;
  }

  return {
    closeTime: cleanString(value.closeTime),
    day: cleanString(value.day),
    isOpen: value.isOpen !== false,
    key,
    openTime: cleanString(value.openTime),
  };
}

function parseOutletProfile(value: unknown): MenuPosOutletProfile {
  if (!isRecord(value)) {
    throw new Error("Menu POS outlet profile response is invalid.");
  }

  const outletKey = cleanString(value.outletKey);
  const name = cleanString(value.name);

  if (!outletKey || !name) {
    throw new Error("Menu POS outlet profile response is invalid.");
  }

  return {
    address: cleanString(value.address),
    bannerImageUrl: cleanUrl(value.bannerImageUrl),
    isActive: value.isActive !== false,
    logoImageUrl: cleanUrl(value.logoImageUrl),
    name,
    openingHours: parseOpeningHours(value.openingHours),
    outletKey,
    phone: cleanString(value.phone),
    publicName: cleanString(value.publicName),
    tagline: cleanString(value.tagline),
  };
}

function parseTableContext(value: unknown): MenuPosTableContext {
  if (!isRecord(value)) {
    throw new Error("Menu POS table response is invalid.");
  }

  const outletKey = cleanString(value.outletKey);
  const qrToken = cleanString(value.qrToken);
  const tableCode = cleanString(value.tableCode);
  const tableLabel = cleanString(value.tableLabel);

  if (!outletKey || !qrToken || !tableCode || !tableLabel) {
    throw new Error("Menu POS table response is invalid.");
  }

  return {
    outletKey,
    qrToken,
    tableCode,
    tableLabel,
  };
}
