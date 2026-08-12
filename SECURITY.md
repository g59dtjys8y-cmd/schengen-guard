# Security Policy

Schengen Guard is a personal project (a static HTML/CSS/JS PWA). Trip data is stored entirely on-device (IndexedDB) — there's no account, no server, and no backend for trip data at all. This policy is scaled to that: there's no formal release/support matrix, just a single live deployment.

## Supported versions

Only the version currently deployed at the live app URL (tracking the `main` branch of this repo) is supported. There are no maintained older releases.

## Reporting a vulnerability

If you find a security issue — for example, an XSS vector through trip data, a way the service worker or a malicious backup file could execute code or corrupt other origins' data, or any other client-side vulnerability — please report it privately rather than opening a public issue:

- Preferred: use GitHub's [private vulnerability reporting](../../security/advisories/new) for this repo (Security tab → "Report a vulnerability"). This opens a private conversation visible only to the repo owner.
- If that's not available to you, open a regular GitHub issue with minimal detail (just enough to confirm receipt) and ask for a private channel to share specifics.

Please include:

- Steps to reproduce, or a proof of concept.
- What data or access the issue exposes.
- Any suggested fix, if you have one.

There's no bug bounty — this is an unpaid personal project — but reports are read and acted on, and you'll get a response acknowledging the report.

## Scope notes

A few things that are expected behavior, not vulnerabilities, given how this app is built:

- Trip data is stored in this browser's IndexedDB, unencrypted, scoped by the browser's normal same-origin storage isolation. Anyone with access to the unlocked device and browser profile can read it — that's standard for client-side storage, not a vulnerability in the app itself.
- There is no server component for trip data, so there's nothing to attack server-side (no API, no database, no auth backend) for that data. Exported backup JSON files are similarly unencrypted local files — protecting them is the user's responsibility, same as any other file on their device.

If you're unsure whether something is in scope, report it anyway and it'll get triaged.
