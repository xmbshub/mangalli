# Changelog

Version numbers follow the cashier tablet app. Each version also includes the
dashboard changes released with it.

## Unreleased

- Pin the dashboard to Next.js 16.4.0, matching the maintained platform
  dependency version. The cashier tablet remains at version 0.8.9.

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
