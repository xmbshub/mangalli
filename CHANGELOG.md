# Changelog

Version numbers follow the cashier tablet app. Each version also includes the
dashboard changes released with it.

## 0.9.1

- Buttons spring back without wobbling when released; the cart badge and the
  payment-complete check pop in once instead of bouncing.
- The app vibrates differently for success (payment complete), rejection
  (wrong PIN, error messages) and plain key taps.
- The order total slides up when it grows and down when it shrinks.
- Dashboard on phones: drag the "More" sheet or a drawer's header down to
  close it; it follows your finger, a quick flick closes it, and it can be
  caught again while moving. Closing with X slides it back down.
- Drawers, toasts and "What's new" now animate out the way they came in
  instead of vanishing.
- Reordering options keeps the dragged row under your finger, and the other
  rows slide into place.
- Reduced motion fades instead of sliding everywhere, including menus and the
  import progress; the bottom bar and header are translucent, and turn solid
  with reduced transparency or high contrast.
- Text sizes follow the browser's text size setting.

## 0.9.0

- Pin the dashboard to Next.js 16.4.0, matching the maintained platform
  dependency version.
- Bills and receipts print the cashier, and the tablet order detail shows
  who served the order.
- The Android app runs on phones: an upright layout with a bottom navigation
  bar, a two-column menu, the order as its own screen, and native Android
  controls (bottom sheets, dialogs, chips, switches). Tablets keep their
  layout.
- Toasts on the dashboard and the app size to their message (short ones stay
  compact, long ones wrap), with a status icon; errors are red.
- Phone details: the keyboard never covers the order total, Charge, or sheet
  buttons; scrolling the menu closes the search keyboard; tapping the keypad
  closes the system keyboard; pull down to refresh Orders; open bills from
  the Menu top bar; a short vibration when a payment completes; quantity
  buttons dim at their limit; chips keep their width when selected.
- "Lock to Mangalli" turns on only after Android confirms the lock; "No
  thanks" leaves it off.
- The payment button ignores a double tap carried over from the order screen.
- Messages say "phone" or "tablet" to match the device.
- Dashboard on phones: a bottom tab bar with More, tables shown as cards,
  tidy two-column filters, full-screen drawers that slide up, bigger switches,
  page buttons and range buttons, a stacked kitchen board, and no zoom when
  typing on iPhone.
- Tablet: a reminder when a shift is still open 2 hours after closing time,
  and when digital menu orders wait while no shift is open. The dashboard
  Overview marks such a shift "Past closing".
- Tablet: a shift that stayed open for more than 7 days shows its real orders
  and cash difference instead of zero orders.
- Dashboard: "Add product" sets up option groups (variants) before saving.
- Orders show the cashier in the list, search and detail, plus who cancelled
  or refunded an order.
- Option group cards no longer clip their corners; edit and add group share
  one compact row.
- Store QRIS accepts PDF and SVG files, and its saved state is a card with
  the merchant name instead of text next to the button.
- PDF reports: columns fit their content, long text wraps, totals, stat cards,
  readable dates and statuses, and landscape pages for wide tables.
- Ask Eline: a cleaner chat panel, proper tables, code, charts and a Copy
  button.
- The Ask Eline button and the credit line sit 12 px from the bottom, level
  with the sidebar.

## 0.8.9

- The tablet shows Online right after a successful sync, instead of staying
  on Offline until the next connection check.

## 0.8.8

- One PIN dialog everywhere on the tablet: lock icon, six dots and a large
  keypad, the same as on the dashboard.
- Dialogs close with the X in their header; the extra Cancel, Keep, Later and
  Done buttons are gone.
- A wrong PIN shows its message between the dots and the keypad.

## 0.8.7

- The PIN keypad has a Clear key next to 0, balancing Delete.
- The keypad sits centred in its dialog.

## 0.8.6

- PIN entry uses six dots and a large keypad, like a phone passcode screen.
- Unlocking the tablet checks the PIN right after the sixth digit.
- Dashboard: the page behind the PIN dialog no longer scrolls, and a wrong PIN
  shakes and clears.

## 0.8.5

- First public release of Mangalli POS under AGPL-3.0.
- Shorter, clearer titles and hints across the dashboard, tablet and digital
  menu; longer explanations moved into tooltips.
- Self-host settings: any OpenAI-compatible AI endpoint, and a tablet build
  for your own server with `-PmangalliServerUrl`.
