# Stress-test data

`stress-test.json` is a Backup & restore-format file (same shape either app exports:
`{ schemaVersion, trips: [...] }`) with 39 trips built to exercise edge cases, not
just realistic usage. Import it from **Settings → Backup & restore → Restore from
backup** in either app (pick "Replace" on an empty account/device for a clean run).

All 29 Schengen countries appear at least once. Dates are relative to **today =
2026-08-17** for the ones where timing matters; everything else lives in the past
(2022–2025) or far future (2028) so it doesn't shift meaning as time passes in a
real test run.

| id prefix | Scenario | What it exercises |
|---|---|---|
| `stress-overlap-a` / `-b` | Two trips overlap by 6 days | Overlap warning, and whether the compliance math double-counts the shared days |
| `stress-exactly-90` | A single 90-day stay | The boundary of compliant — should read as *safe*, zero days over |
| `stress-exactly-91` | A single 91-day stay | One day over the limit — should read as *overstay*, not safe |
| `stress-long-overstay` | A 198-day stay | Large numbers in the overstay UI, "days over" math well past the limit |
| `stress-backtoback-1` / `-2` | Exit day of one trip = entry day of the next | Whether the shared boundary day gets double-counted |
| `stress-newyear` | Dec 20 – Jan 10 | Year-view/grid rendering across a year boundary |
| `stress-active` | Spans today (2026-08-17) | Home's "Active trip" card |
| `stress-planned-soon` | Starts 2026-09-05 | Home's "Next trip" card, extend-by-N-days suggestion |
| `stress-planned-far` | 2028-06-01 | Year-view navigation several years out |
| `stress-exclusion-middle` | Side trip excluded from the middle of a stay | Exclusion rendering + calculation on the calendar and breakdown |
| `stress-exclusion-edge` | Excluded range starts on the trip's first day | Exclusion-touching-boundary edge case |
| `stress-empty-label` | No country selected | The "—" placeholder fallback, no flag icon |
| `stress-note-unicode` | Emoji, accented characters, currency symbols in the note | Text rendering/encoding |
| `stress-note-xss` | `<script>`/`<img onerror>` in the note | Confirms notes are HTML-escaped, not executed |
| `stress-note-long` | A ~600-character note | Text wrapping and card growth on the trip row |
| `stress-single-day` | Same start and end date | Minimum possible trip duration |
| `stress-fill-*` / `stress-extra-*` | Short trips filling in the remaining countries + extra volume | List length, "Completed trips" collapse group, Year grid density, History chart |

Regenerate or tweak it with `gen_stress_data.py` (not checked in — ask for it again
if you need to regenerate with different parameters).
