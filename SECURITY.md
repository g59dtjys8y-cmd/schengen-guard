# Security Policy

Schengen Buddy is a personal project (a static HTML/CSS/JS PWA backed by Supabase for auth and trip storage). This policy is scaled to that: there's no formal release/support matrix, just a single live deployment.

## Supported versions

Only the version currently deployed at the live app URL (tracking the `main` branch of this repo) is supported. There are no maintained older releases.

## Reporting a vulnerability

If you find a security issue — for example, a way to read or modify another user's trip data, bypass authentication, or anything involving the Supabase keys or Row Level Security policies — please report it privately rather than opening a public issue:

- Preferred: use GitHub's [private vulnerability reporting](../../security/advisories/new) for this repo (Security tab → "Report a vulnerability"). This opens a private conversation visible only to the repo owner.
- If that's not available to you, open a regular GitHub issue with minimal detail (just enough to confirm receipt) and ask for a private channel to share specifics.

Please include:

- Steps to reproduce, or a proof of concept.
- What data or access the issue exposes.
- Any suggested fix, if you have one.

There's no bug bounty — this is an unpaid personal project — but reports are read and acted on, and you'll get a response acknowledging the report.

## Scope notes

A few things that are expected behavior, not vulnerabilities, given how Supabase works:

- The Supabase project URL and anon/public API key are visible in `script.js`. This is standard for Supabase's client-side model — the anon key is meant to be public. Actual data access is enforced server-side via Postgres Row Level Security policies scoping each user to their own `trips` rows.
- Sessions auto-expire after 1 day of inactivity, but there's no server-side session revocation UI (e.g. "sign out other devices") yet.

If you're unsure whether something is in scope, report it anyway and it'll get triaged.
