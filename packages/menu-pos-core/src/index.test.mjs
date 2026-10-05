import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  canTransitionRestaurantOrderStatus,
  createMenuPosHttpAdapter,
  menuPosReadContractPassed,
  parseMenuPosBindings,
  publicMenuPosConfig,
  validateMenuPosCreateOrderInput,
  verifyMenuPosReadContract,
} = await import("./index.ts");

describe("menu POS adapter contract", () => {
  it("parses server-side bindings and exposes only safe public config", () => {
    const bindings = parseMenuPosBindings(
      JSON.stringify({
        "menu-demo.localhost": {
          adminUrl: " https://pos.example.test/admin ",
          apiBaseUrl: " https://pos.example.test/api/ ",
          apiToken: " server-token ",
          outletKey: "senja",
          provider: "mangalli-pos",
          publicUrl: " https://pos.example.test/ ",
        },
      }),
    );

    assert.deepEqual(bindings["menu-demo.localhost"], {
      adminUrl: "https://pos.example.test/admin",
      apiBaseUrl: "https://pos.example.test/api",
      apiToken: "server-token",
      outletKey: "senja",
      provider: "mangalli-pos",
      publicUrl: "https://pos.example.test",
    });
    assert.deepEqual(publicMenuPosConfig(bindings["menu-demo.localhost"]), {
      hasMenuPos: true,
      provider: "mangalli-pos",
      publicUrl: "https://pos.example.test",
    });
    assert.equal(Object.hasOwn(publicMenuPosConfig(bindings["menu-demo.localhost"]), "apiToken"), false);
  });

  it("validates QR dine-in and takeaway order requirements", () => {
    assert.deepEqual(
      validateMenuPosCreateOrderInput({
        items: [{ menuItemId: "americano", quantity: 1 }],
        mode: "dinein",
        outletKey: "senja",
      }),
      ["dinein orders require an active QR table."],
    );

    assert.deepEqual(
      validateMenuPosCreateOrderInput({
        items: [{ menuItemId: "latte", quantity: 2 }],
        mode: "takeaway",
        outletKey: "senja",
        pickupName: "Budi",
      }),
      [],
    );
  });

  it("treats invalid binding JSON as no bindings", () => {
    assert.deepEqual(parseMenuPosBindings("{invalid-json"), {});
  });

  it("enforces restaurant order state transitions", () => {
    assert.equal(canTransitionRestaurantOrderStatus("new", "accepted"), true);
    assert.equal(canTransitionRestaurantOrderStatus("accepted", "ready"), true);
    assert.equal(canTransitionRestaurantOrderStatus("ready", "new"), false);
    assert.equal(canTransitionRestaurantOrderStatus("completed", "cancelled"), false);
  });

  it("calls the POS HTTP adapter with server-side auth and stable endpoint paths", async () => {
    const calls = [];
    const adapter = createMenuPosHttpAdapter({
      binding: {
        apiBaseUrl: "https://pos.example.test/api",
        apiToken: "adapter-token",
        outletKey: "senja",
        provider: "mangalli-pos",
      },
      fetchFn: async (url, init) => {
        calls.push({ init, url: String(url) });

        if (String(url).endsWith("/outlets/senja/menu")) {
          return Response.json({
            items: [
              {
                category: "Coffee",
                id: "latte",
                isAvailable: true,
                name: "Latte",
                priceLabel: "Rp 28.000",
              },
            ],
          });
        }

        if (String(url).endsWith("/qr-tables/kopi-t31")) {
          return Response.json({
            outletKey: "senja",
            qrToken: "kopi-t31",
            tableCode: "T31",
            tableLabel: "Dine In - 31",
          });
        }

        if (String(url).endsWith("/orders") && init.method === "POST") {
          return Response.json({
            code: "ORD-1",
            id: "order-1",
            mode: "dinein",
            publicToken: "public-order-token",
            status: "new",
            tableLabel: "Dine In - 31",
          });
        }

        if (String(url).endsWith("/orders/order-1/status")) {
          return Response.json({
            code: "ORD-1",
            id: "order-1",
            mode: "dinein",
            publicToken: "public-order-token",
            status: "accepted",
            tableLabel: "Dine In - 31",
          });
        }

        if (String(url).endsWith("/outlets/senja/orders")) {
          return Response.json({
            orders: [
              {
                code: "ORD-1",
                createdAt: "2026-06-21T15:00:00.000Z",
                customerName: "Budi",
                id: "order-1",
                lines: [
                  {
                    name: "Latte",
                    note: "Less sugar",
                    priceLabel: null,
                    quantity: 2,
                  },
                ],
                mode: "dinein",
                paymentStatus: "pending",
                pickupName: null,
                publicToken: "public-order-token",
                status: "new",
                tableLabel: "Dine In - 31",
                totalPriceLabel: "Rp 61.600",
              },
            ],
          });
        }

        if (String(url).endsWith("/outlets/senja/profile") && init.method === "PATCH") {
          return Response.json({
            address: "Jl. Payload",
            bannerImageUrl: "https://media.example.test/banner.jpg",
            isActive: false,
            logoImageUrl: "https://media.example.test/logo.png",
            name: "Senja Internal",
            openingHours: [
              {
                closeTime: "23:00",
                day: "Senin",
                isOpen: true,
                key: "monday",
                openTime: "07:00",
              },
            ],
            outletKey: "senja",
            phone: "+6281234567890",
            publicName: "Senja Payload",
            tagline: "Ngopi sek ben waras",
          });
        }

        return new Response(null, { status: 404 });
      },
    });

    assert.deepEqual(await adapter.getOutletMenu("senja"), [
      {
        category: "Coffee",
        description: null,
        id: "latte",
        imageUrl: null,
        isAvailable: true,
        name: "Latte",
        priceLabel: "Rp 28.000",
        sortOrder: null,
      },
    ]);
    assert.deepEqual(await adapter.resolveQrTable("kopi-t31"), {
      outletKey: "senja",
      qrToken: "kopi-t31",
      tableCode: "T31",
      tableLabel: "Dine In - 31",
    });
    assert.equal((await adapter.createOrder({
      items: [{ menuItemId: "latte", quantity: 1 }],
      mode: "dinein",
      outletKey: "senja",
      table: {
        outletKey: "senja",
        qrToken: "kopi-t31",
        tableCode: "T31",
        tableLabel: "Dine In - 31",
      },
    })).status, "new");
    assert.equal((await adapter.transitionOrder("order-1", "accepted")).status, "accepted");
    assert.deepEqual(await adapter.listOrders("senja"), [
      {
        code: "ORD-1",
        createdAt: "2026-06-21T15:00:00.000Z",
        customerName: "Budi",
        id: "order-1",
        lines: [
          {
            name: "Latte",
            note: "Less sugar",
            priceLabel: null,
            quantity: 2,
          },
        ],
        mode: "dinein",
        paymentStatus: "pending",
        pickupName: null,
        publicToken: "public-order-token",
        status: "new",
        tableLabel: "Dine In - 31",
        totalPriceLabel: "Rp 61.600",
      },
    ]);
    assert.deepEqual(await adapter.syncOutletProfile("senja", {
      address: "Jl. Payload",
      bannerImageUrl: "https://media.example.test/banner.jpg",
      isActive: false,
      logoImageUrl: "https://media.example.test/logo.png",
      openingHours: [
        {
          closeTime: "23:00",
          day: "Senin",
          isOpen: true,
          key: "monday",
          openTime: "07:00",
        },
      ],
      phone: "+6281234567890",
      publicName: "Senja Payload",
      tagline: "Ngopi sek ben waras",
    }), {
      address: "Jl. Payload",
      bannerImageUrl: "https://media.example.test/banner.jpg",
      isActive: false,
      logoImageUrl: "https://media.example.test/logo.png",
      name: "Senja Internal",
      openingHours: [
        {
          closeTime: "23:00",
          day: "Senin",
          isOpen: true,
          key: "monday",
          openTime: "07:00",
        },
      ],
      outletKey: "senja",
      phone: "+6281234567890",
      publicName: "Senja Payload",
      tagline: "Ngopi sek ben waras",
    });

    assert.equal(calls[0].url, "https://pos.example.test/api/outlets/senja/menu");
    assert.equal(calls[0].init.headers.authorization, "Bearer adapter-token");
    assert.equal(calls[2].init.method, "POST");
    assert.equal(calls[2].init.headers["content-type"], "application/json");
    assert.equal(calls[4].url, "https://pos.example.test/api/outlets/senja/orders");
    assert.equal(calls[5].init.method, "PATCH");
  });

  it("maps missing public order and QR table lookups to null", async () => {
    const adapter = createMenuPosHttpAdapter({
      binding: {
        apiBaseUrl: "https://pos.example.test/api",
        outletKey: "senja",
        provider: "mangalli-pos",
      },
      fetchFn: async () => new Response(null, { status: 404 }),
    });

    assert.equal(await adapter.getOrderStatus("missing"), null);
    assert.equal(await adapter.resolveQrTable("missing"), null);
  });

  it("fails fast when the POS adapter returns an invalid order payload", async () => {
    const adapter = createMenuPosHttpAdapter({
      binding: {
        apiBaseUrl: "https://pos.example.test/api",
        outletKey: "senja",
        provider: "mangalli-pos",
      },
      fetchFn: async () => Response.json({ id: "order-1" }),
    });

    await assert.rejects(
      () => adapter.createOrder({
        items: [{ menuItemId: "latte", quantity: 1 }],
        mode: "takeaway",
        outletKey: "senja",
        pickupName: "Budi",
      }),
      /Menu POS order response is invalid/,
    );
  });

  it("verifies the read-only POS adapter contract for a demo outlet", async () => {
    const checks = await verifyMenuPosReadContract({
      adapter: {
        getOutletMenu: async () => [
          {
            id: "latte",
            isAvailable: true,
            name: "Latte",
            priceLabel: "Rp 28.000",
          },
        ],
        resolveQrTable: async () => ({
          outletKey: "senja",
          qrToken: "kopi-t31",
          tableCode: "T31",
          tableLabel: "Dine In - 31",
        }),
      },
      outletKey: "senja",
      qrToken: "kopi-t31",
    });

    assert.equal(menuPosReadContractPassed(checks), true);
    assert.deepEqual(checks.map((check) => check.name), ["outlet_menu", "qr_table"]);
  });

  it("reports read-only contract failures without creating orders", async () => {
    const checks = await verifyMenuPosReadContract({
      adapter: {
        getOutletMenu: async () => [],
        resolveQrTable: async () => null,
      },
      outletKey: "senja",
      qrToken: "missing",
    });

    assert.equal(menuPosReadContractPassed(checks), false);
    assert.deepEqual(checks.map((check) => check.ok), [false, false]);
    assert.match(checks[0].message, /no items/);
    assert.match(checks[1].message, /did not resolve/);
  });
});
