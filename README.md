# Mangalli POS

Point of sale for cafés and restaurants: a web dashboard for the owner and an
Android app for the cashier tablet that keeps selling without internet.
Free to self-host, by [1garis Studio](https://1garis.id).

## Features

- Cashier tablet (Android): orders, open bills, tables, cash,
  QRIS on screen or on the receipt, Bluetooth receipt and kitchen printers,
  shifts with cash in/out, voids and refunds with a manager PIN, offline sync.
- Dashboard: products with options and stock, categories, tables and QR codes,
  promotions, expenses, reports (sales, products, profit and loss, Excel and
  PDF), team and roles, audit log, several branches under one brand.
- Ask Eline: an assistant that answers questions about your sales and turns a
  menu photo or chat into draft products (needs an AI key, see below).
- Daily report email, data export and import, in-app tablet updates.

The customer-facing digital menu (scan the table QR, order and pay from the
phone) is a hosted service from 1garis Studio and is not part of this
repository. The dashboard exposes the menu and order API it uses.

## Self-host

Requirements: Docker with Compose.

```bash
git clone https://github.com/xmbshub/mangalli.git
cd mangalli
cp apps/mangalli-pos/.env.example .env
```

Fill in `.env`: at least `POS_SESSION_SECRET`, `POS_OWNER_EMAIL`,
`POS_OWNER_PASSWORD` and `MANGALLI_PUBLIC_URL`. Then:

```bash
docker compose up -d --build
docker compose exec pos pnpm db:seed
```

Open `http://localhost:4107`, sign in with outlet code `demo` and the owner
email and password from `.env`. Put the dashboard behind HTTPS (Caddy, Nginx or
a tunnel) before connecting tablets.

### Optional services

Every outside service uses your own account and key. Leave a variable empty to
turn that feature off.

| Feature | Variables |
| --- | --- |
| Ask Eline, menu import | `MANGALLI_ROUTER_URL`, `MANGALLI_ROUTER_KEY`, `MANGALLI_ROUTER_MODEL` (any OpenAI-compatible endpoint) |
| Online payments | `MIDTRANS_SERVER_KEYS_JSON`, `MIDTRANS_IS_PRODUCTION` |
| Photo uploads | `R2_*` (Cloudflare R2, MinIO or S3) |
| Daily report email | `SMTP_*` |

### Cashier tablet

Build the APK for your server (Android SDK and JDK 17):

```bash
cd apps/mangalli-pos/android-pos
./gradlew assembleRelease -PmangalliServerUrl=https://pos.example.com
```

Sign it with your own key (see `apps/mangalli-pos/android-pos/README.md`) and
keep that key: tablets only accept updates signed with the same key.

## Development

```bash
pnpm install
docker compose up -d db   # or any PostgreSQL; set DATABASE_URL in apps/mangalli-pos/.env.local
pnpm db:migrate && pnpm db:seed
pnpm dev
```

Checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `./gradlew testDebugUnitTest`
in `apps/mangalli-pos/android-pos`.

## Hosted by 1garis Studio

Prefer not to run a server? 1garis Studio rents a managed Mangalli server
(updates, backups, AI included) and offers the digital menu. See
[1garis.id](https://1garis.id).

## Contributing

This repository is published from the 1garis Studio monorepo. Issues and pull
requests are welcome; accepted changes are applied there and appear here with
the next sync.

## License

GNU Affero General Public License v3.0. See [LICENSE](LICENSE).
