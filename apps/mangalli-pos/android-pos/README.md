# Mangalli Android POS

Native Android cashier app for Mangalli POS.

Offline-first since 2026-09-25: the tablet is the operational source of truth.
The cashier keeps selling without internet; the dashboard receives data at sync.

- **Sign in:** the first sign-in of each cashier on a tablet is online (`POST /api/android-pos/auth/device-login`). After that the tablet keeps a PBKDF2 hash of the password (Android Keystore encrypted) and signs the cashier in offline.
- **Shifts:** open and close on the tablet with starting and counted cash. Payments require an open shift.
- **Orders:** payments, open bills (saved per table), kitchen queue, status changes and cancellations are stored in Room (`local_orders`, `local_shifts`). Only new kitchen items print when a bill is reopened.
- **Sync:** full sync pushes shift and order snapshots through `POST /api/android-pos/sync/v2` and pulls the menu (`GET /api/android-pos/bootstrap`). It runs at the scheduled times set in the dashboard (Outlet settings, default 11:00, 15:00, 19:00, 23:00), on **Sync Now**, and on every shift close. Missed times (tablet off) are caught up. The server accepts snapshots as sent (tablet time and price, even if the menu changed) and logs price differences in the audit log.
- **Digital menu:** while online the tablet checks `GET /api/android-pos/menu-orders` every minute. Orders waiting for payment show under New Orders; **Receive Payment** moves them to the kitchen, prints the ticket and pushes the change immediately.
- **Legacy queue:** transactions queued by earlier app versions are still sent through `POST /api/android-pos/sync` at the next sync.
- Cancellation after processing starts needs a manager/owner password known on this tablet (or an owner/manager signed in).

Custom Amount is a first-class non-catalog order item. The server validates its name and unit price, applies the same order tax, stores an immutable item snapshot, records a POS audit log, and excludes it from kitchen tickets. Configure the per-line ceiling with `ANDROID_POS_CUSTOM_AMOUNT_MAX` (default `10000000`).
- follows the digital menu UI (see UI Standards)

Not included yet:

- phone-optimized cashier layout
- persistent retry queue for failed print jobs
- refund/void/edit flows for orders already synced
- more than one cashier tablet per outlet (offline data lives on one tablet)

## Run

Open `android-pos/` in Android Studio, let Gradle sync, then run the `app` module.

Android Studio first run:

1. Click **Sync Now** when Android Studio shows the Gradle sync banner.
2. Wait until sync finishes without errors.
3. If the top bar says **No Devices**, open **Device Manager** and create an emulator, or connect a real Android device with USB debugging enabled.
4. Select the `app` run configuration.
5. Select the emulator or device.
6. Click the Run button.

If Android Studio shows files named `._gradle`, `._build.gradle.kts`, or similar, they are macOS AppleDouble files from the external drive. Close Android Studio or stop Gradle, then run this from the repository root:

```bash
find android-pos -name '._*' -delete
```

This project writes Android build output to `~/.gradle/mangalli-android-pos-build` instead of `android-pos/build` so Android resource packaging does not fail on external drives that create `._*` files.

Default API base URL:

```text
https://app.mangalli.web.id
```

Debug builds only: point the app at a local server and allow HTTP to the emulator host.

```bash
adb shell am start -n id.mangalli.pos/.MainActivity --es mangalli.baseUrl http://10.0.2.2:4107
```

The app needs:

- outlet key/code
- staff email/password for an active `owner`, `manager`, or `staff` user in the same outlet

## Release builds and updates

`./gradlew assembleRelease` signs with the release key from
`~/.mangalli/android-release/keystore.properties` (outside the repo, with
`storeFile`, `storePassword`, `keyAlias` and `keyPassword`; keep a backup of the
keystore). Every release must use this key, otherwise installed tablets cannot
update in place. Debug builds keep the debug key and the test-server switch.

The tablet talks to `https://app.mangalli.web.id` (1garis Studio hosting). A
self-hosted server builds its own APK with
`./gradlew assembleRelease -PmangalliServerUrl=https://pos.example.com`.

The app checks `GET /api/android-pos/app-update` when it opens and after each
sync (at most every 30 minutes) and from Settings → Check for updates. It
downloads the APK to the cache, verifies its SHA-256 and installs it through
`PackageInstaller` (`update/AppUpdater.kt`). Android asks once to allow
installs from Mangalli and then asks the cashier to tap Install; screen pinning
is released first. Publishing is described in the app README (App releases).

## Using The App

Tablet-first, landscape. The app has five screens on a permanent left rail: **Menu**, **Orders** (badge = orders that need action), **History**, **Shift** (dot = shift closed), **Settings**. The rail also shows connection and sync state (tap to sync) and the cashier avatar (tap to lock). When the tablet clock is more than 5 minutes off the server (read from the HTTP `Date` header), a banner with **Fix clock** opens Android date settings; the sign-in screen shows the same warning.

1. **Connect this tablet** (first time, needs internet): outlet code, email, password of an owner or manager. The menu, tables, tax rate, and sync times are downloaded. Keyboard Next/Go moves through the fields.
2. **Who's working?** Afterwards the sign-in screen lists cashiers who signed in on this tablet; choose a name and enter the password (works offline). **Use another account** signs in a new cashier online.
3. **Shift**: open with the starting cash (numpad and presets). While open, the screen shows cash/non-cash sales, open bills, expected cash, and this shift's transactions. Close by counting the drawer; the difference is shown before confirming, and the report can be printed. Open bills can move to the next shift (cashiers need manager approval); a cash difference needs a note. Opening asks for confirmation and moves carried bills into the new shift.
4. **Menu**: search and category chips follow the dashboard order. Cards show photo, price, Sold out (not tappable), Best seller/Favourite, and a badge with the quantity already in the order. Products with options open a sheet (required groups preselected, quantity, kitchen note). **Custom amount** is a toggle next to search.
5. Order panel: Takeaway/Dine in, table picker (outlet tables grouped by area, or type a number; table numbers are unique per outlet across areas), customer name, quantity steppers per line (44 dp keys; tap a line to edit its options). Removing a line asks to confirm, and the Remove button in the edit sheet needs a second tap. **Save bill** keeps it open and sends new items to the kitchen printer; lowering a saved item opens **Void** (reason, manager/owner password for cashiers); **Open bills** reopens it. **Charge** opens payment: Cash (numpad, quick amounts, empty = exact), QRIS, Card, Transfer, Other. QRIS shows on screen with the amount (ZXing `QrImage`, Enlarge for the customer) and can be printed like a card machine slip ("Print"): the store QRIS from bootstrap (`qrisPayload`) becomes a dynamic code with the exact amount (`offline/Qris.kt`, same algorithm as `server/qris.ts`) printed with the printer's ESC/POS QR command; printed bills carry it too. The cashier confirms after the customer's payment succeeds.
6. **Orders**: Awaiting payment (digital menu), Preparing, Ready. Tap a card for items and actions: Receive payment, Accept, Mark ready, Take payment, Complete, Edit in menu, Receipt, Cancel or Refund & cancel (reason; manager/owner password when a cashier cancels an order the kitchen has or refunds a paid one). Reprints say COPY.
7. **History**: last 7 days of sales (filters, search, reprint receipt) and shifts (cash counts, print report). Synced orders show the dashboard code next to the tablet number (`#001 · 1GK-1552`).
8. **Settings**: outlet and device (disconnect: owner/manager only, warns about unsynced data), sync status and schedule, printers (choose, test), cashiers on this tablet (remove: owner/manager), and Problems & help (report a problem; crashes and sync rejections are reported automatically).

## UI Standards

The digital menu (`apps/sites/designs/digital-menu-mobile`) is the UI reference for the dashboard and this app. Tokens and components live in `ui/Theme.kt` and `ui/Components.kt`; screens only use them.

- Colours: accent `#EA580C` (pressed `#C2410C`, soft `#FFF7ED`/`#FFEDD5`), ink `#18181B`, text `#3F3F46`, muted `#71717A`, line `#E4E4E7`, canvas `#F4F4F5`; status tones success/warning/danger/info.
- Type: 32 amounts, 20 titles, 16 headings, 14 body/labels, 12 captions; weights 400 and 500 only.
- Shape and space: controls 12dp, cards 16dp, dialogs 20dp; spacing in 4dp steps; controls 44dp (52dp primary actions, 56dp beside text fields). Cards are flat (1dp border, no shadow); dialogs float.
- Behaviour: press feedback on every tappable, haptics on add/charge, loading state inside buttons, toasts for results (errors stay longer), confirm dialogs for destructive actions, numpads instead of the system keyboard for money.
- Product images follow the dashboard photos (SVG supported); products without a photo show initials.

## Bluetooth Thermal Printer Setup

The Android app supports generic 58 mm Bluetooth Classic thermal printers that accept ESC/POS data over RFCOMM/SPP.

Customer bills and payment receipts use the outlet public name, logo, address, and phone from the bootstrap profile, followed by Mangalli POS and 1garis Studio credits. Kitchen tickets use the same outlet identity but prioritize a large order reference, service context, quantity, modifiers, and notes without prices. Raster logo loading is best-effort; printing falls back to the outlet name when the image is unavailable or unsupported.

1. Turn on the thermal printer and Bluetooth on the Android tablet.
2. Open Android **Settings > Connected devices > Pair new device**.
3. Select the printer and enter its PIN when requested. Common printer defaults are `0000` or `1234`; use the printer manual if those do not work.
4. Open Mangalli POS **Panel > Settings > Printer**.
5. Assign **Receipt / Bill Printer**. This printer receives customer bills before payment and payment receipts after payment.
6. Assign **Kitchen Ticket Printer**. This printer receives kitchen tickets without prices.
7. The same physical printer can be assigned to both roles for a small outlet, or two different printers can be used for cashier and kitchen.
8. Tap **Test** for each role. A successful 58 mm test should print a 32-character-wide sample.

Current print routing:

- **Print Bill**: customer-facing price summary marked as payment pending.
- **Save & Print New Items**: saves the full open bill, prints only pending kitchen quantities, and records the printed quantity after the printer write succeeds.
- **Print Receipt**: available after payment and includes payment status plus totals.

The app uses Android's paired-device list and requests only the Nearby Devices connection permission on Android 12+. Pairing remains in Android Settings. Automatic cutting is intentionally disabled because most portable 58 mm Bluetooth printers use a manual tear bar.

## Language And Localization

- English is the current product language across Android POS, web admin, customer ordering, receipts, and API validation responses.
- Laravel uses `APP_LOCALE=en` and `APP_FALLBACK_LOCALE=en`. Inertia shares `locale` and `supportedLocales` with every page.
- React locale keys live in `resources/js/lib/i18n.ts`. Add reusable copy there instead of introducing new language conditionals inside components.
- Android declares `en` and `id` in `res/xml/locales_config.xml`. Shared Android labels belong in `res/values/strings.xml`; add `res/values-id/strings.xml` only when the Indonesian catalog is complete.
- Indonesian is reserved as the next optional locale. Until its catalog is complete, unsupported or missing keys intentionally fall back to English.
- Internal API values and database statuses remain language-neutral and must not be translated.

## QA Path

1. Register device.
2. Login staff.
3. Bootstrap catalog.
4. Tap products into cart.
5. Continue to payment.
6. Save a paid take-away and dine-in order.
7. Confirm the app can send unsent transactions automatically or manually from settings.
8. Confirm the order appears in the web admin order list.
9. Open Order Tracking, confirm active orders show paid/unpaid badges, and move an order through the allowed legacy status sequence.
10. Confirm completed, cancelled, and refunded orders appear in Activity instead of Order Tracking.
11. Confirm **Bayar & Tutup Pesanan** settles the existing delivered bill without creating a duplicate order.

## Required Before Device QA

- Android Studio with Android SDK installed.
- Live or local backend URL reachable from the Android device.
- `ANDROID_POS_SETUP_TOKEN` configured on the backend server.
- Active outlet, active menu products, and at least one active staff account.
- Open POS shift before sending cashier orders.
