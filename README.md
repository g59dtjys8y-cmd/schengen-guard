# Schengen Guard

A free web app for tracking Schengen Area visits and staying compliant with the 90/180-day short-stay rule. Live, installable as an app, and fully private — your trips are stored only on your own device, with no account and no server.

**Live app:** https://g59dtjys8y-cmd.github.io/schengen-guard/

## Features

- **Home dashboard** — an arc progress ring shows days left of your rolling 90, with a gold EU-star marker that travels around it and shifts color as the limit approaches. Below it: your last day to leave (checkable against any reference date, not just today), your next upcoming trip, and a countries-visited summary.
- **Tabbed navigation** — Home, Trips, Calendar, and Settings, with a fixed bottom tab bar for quick switching between views.
- **Safe Trip Checker** — on the Trips tab, enter a country and candidate entry/exit dates to see live whether that stay would keep you compliant and how many days of margin you'd have, *before* you save it.
- **Trip list with status** — logged stays show a "DONE" stamp once they're in the past and a planned tag while they're upcoming; edit or remove any trip inline.
- **Countries visited** — a stamp-style grid of all 29 Schengen countries, marking which ones you've logged a stay in.
- **One calendar for everything** — tap an entry date, then an exit date, to log a stay. Every date also shows your remaining day allowance as of that day, with past/active, planned, and overstay stays visually distinguished.
- **Overstay warnings** — any logged trip that pushes your rolling 180-day total past 90 days is flagged directly against that trip, with the exact date and running total.
- **Overlap detection** — warns you if a new stay overlaps one you've already logged.
- **Notification thresholds** — opt in (from Settings) to a browser notification when your days remaining hits 14, 7, or 3, based on your logged and planned trips.
- **Light, dark & auto themes** — switch between them from Settings → Appearance; "Auto" follows your OS setting and updates live. Your choice is remembered on your device and applied before first paint, so there's no flash of the wrong theme.
- **Local-only storage, no account** — trips are stored on-device (IndexedDB); nothing is ever sent to a server. Back up or move to a new device with JSON export/import from Settings.
- **Installable app (PWA)** — add it to your phone's home screen for a full-screen, app-like experience with an offline fallback. On platforms that support it, the home screen icon shows a badge with today's days-left count, which stays current day to day whenever the app is open or refocused.
- **All 29 Schengen countries** — pick from a dropdown, defaulting to Spain.

## Tech stack

- Plain HTML, CSS, and JavaScript — no build step, no framework.
- [Source Serif 4](https://fonts.google.com/specimen/Source+Serif+4) for headlines and UI text, in a light-first "Broadsheet" design system driven by CSS custom properties (with a parallel dark palette applied via `prefers-color-scheme` / a `data-theme` override).
- IndexedDB for on-device trip storage — no backend, no accounts.
- A web app manifest and service worker for PWA installability.

## Project files

| File | Purpose |
|---|---|
| `index.html` | Page structure and layout |
| `style.css` | All styling |
| `script.js` | App logic — date math, calendar rendering, IndexedDB storage, export/import |
| `manifest.json` | PWA metadata (name, icons, theme colors) |
| `sw.js` | Service worker for offline fallback and installability |
| `icon-192.png` / `icon-512.png` | App icons |

## Running it yourself

There's no backend to set up. Serve the files with any static host — GitHub Pages, Netlify, Vercel — or just open `index.html` directly. Trip data is stored per-browser-origin in IndexedDB, so each deployment/origin has its own separate data.

## Rule reference

The Schengen short-stay rule allows non-EU visitors to stay up to 90 days in any rolling 180-day period across the Schengen Area. This app is a personal tracking tool, not immigration advice.

## License

Personal project — no license specified.
