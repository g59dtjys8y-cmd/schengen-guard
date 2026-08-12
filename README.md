# Schengen Guard

A web app for tracking Schengen Area visits and staying compliant with the 90/180-day short-stay rule. Live, installable as an app, and backed by a real database so your trips are saved to your account.

**Live app:** not yet deployed from this repo — GitHub Pages hasn't been enabled here yet.

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
- **Accounts & real persistence** — sign in with email/password; your trips are stored in a Supabase database tied to your account, not just your browser. You're automatically signed out if the app hasn't been opened in 1 day.
- **Installable app (PWA)** — add it to your phone's home screen for a full-screen, app-like experience with an offline fallback. On platforms that support it, the home screen icon shows a badge with today's days-left count, which stays current day to day whenever the app is open or refocused.
- **All 29 Schengen countries** — pick from a dropdown, defaulting to Spain.

## Tech stack

- Plain HTML, CSS, and JavaScript — no build step, no framework.
- [Source Serif 4](https://fonts.google.com/specimen/Source+Serif+4) for headlines and UI text, in a light-first "Broadsheet" design system driven by CSS custom properties (with a parallel dark palette applied via `prefers-color-scheme` / a `data-theme` override).
- [Supabase](https://supabase.com) for authentication and the Postgres database (a `trips` table, scoped per-user with Row Level Security).
- A web app manifest and service worker for PWA installability.

## Project files

| File | Purpose |
|---|---|
| `index.html` | Page structure and layout |
| `style.css` | All styling |
| `script.js` | App logic — date math, calendar rendering, Supabase calls |
| `manifest.json` | PWA metadata (name, icons, theme colors) |
| `sw.js` | Service worker for offline fallback and installability |
| `icon-192.png` / `icon-512.png` | App icons |

## Running it yourself / setting up your own database

1. Create a free project at [supabase.com](https://supabase.com).
2. Create a `trips` table with columns: `start_date` (date), `end_date` (date), `country` (text), plus a `user_id` column:
   ```sql
   alter table trips add column user_id uuid references auth.users(id) default auth.uid();
   create policy "Users manage own trips" on trips for all
     using (auth.uid() = user_id) with check (auth.uid() = user_id);
   ```
3. In **Authentication → Providers**, confirm Email is enabled. Optionally turn off "Confirm email" for simpler local testing.
4. In `script.js`, replace `SUPABASE_URL` and `SUPABASE_KEY` with your own project's values (found under **Settings → API**).
5. Serve the files with any static host — GitHub Pages, Netlify, Vercel, or just open `index.html` directly.

## Rule reference

The Schengen short-stay rule allows non-EU visitors to stay up to 90 days in any rolling 180-day period across the Schengen Area. This app is a personal tracking tool, not immigration advice.

## License

Personal project — no license specified.
