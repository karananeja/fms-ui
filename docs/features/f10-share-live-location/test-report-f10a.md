# F10a — Share live location: create + manage · Test report

**Date:** 2026-10-14 · **Scope:** F10-R1…R7, F10-T1…T3, F10a part of T8 · **Branch:** `integration/f10` (uncommitted; the orchestrator commits)

Only targeted runs were done here, as instructed. The full `pnpm check`, `pnpm build`, e2e suite and clock project are run once by the orchestrator after F10a and F10b are both in (F10-T10).

## Commands and results
| Command | Result |
|---|---|
| `pnpm exec tsc -b` | clean (0 errors, whole project incl. F10b's files at that moment) |
| `pnpm exec eslint src/features/share/{api,lib,manage} src/app src/features/access src/features/live-tracking/components` | clean (0 errors, 0 warnings) |
| `pnpm vitest run src/features/share/lib src/features/share/manage src/app src/features/access src/features/live-tracking/components/vehicle-details-panel.test.tsx` | **12 files, 113/113 passed** |
| `VITE_PORT=5273 MOCK_PORT=4101 pnpm playwright test e2e/share-manage.spec.ts --project=setup --project=chromium --output=test-results-f10a` | **4/4 passed** (setup + 3 F10-T3 tests, 11.2 s) |

The first e2e run failed 3/4 with no panel/overview card: the Vite dev server was doing dependency re-optimisation and full reloads (the trace shows repeated `[vite] connecting…`), while F10b was editing files in the same directory. The unchanged re-run passed 4/4. If it shows up again in the full run, re-run the single spec.

## Requirements
| ID | Result | Evidence |
|---|---|---|
| F10-R1 Entry point | Pass | Panel tests "Share CTA shows only with share.create and opens the Share dialog" / "no Share CTA without share.create"; F07 test still asserts no CTA without it; e2e T3 #1 and #3. 480 px card ≥ 640 px, bottom sheet below (CSS) |
| F10-R2 Expiry | Pass | T1 (9 tests); T2 "defaults", "custom expiry: IST inputs, inline errors" |
| F10-R3 Visible data | Pass | T2 "defaults" (Location checked + disabled; group descriptions from `SHARE_GROUP_KEYS`) |
| F10-R4 Trail | Pass | T2 "create sends the chosen options" (off by default, 1 h default, 6 h picked → 360) |
| F10-R5 Create + result | Pass | T2 exact body, URL = origin + `/share/<token>`, Copy → clipboard + "Copied" + toast, Open (`_blank`), Create another; 422 / 403 inline; e2e T3 #1 clipboard = URL, public GET 200 |
| F10-R6 Links tab | Pass | T2 "Links tab…" (count, newest first, statuses, chips, creator, "Show 2 inactive", confirm text, revoke → count drops); "without share.revoke" (revoke only on own, no creator); e2e T3 #1 revoke → public 410 |
| F10-R7 Admin list | Pass | e2e T3 #2 (overview card, nav item, default Active filter, regno search + link to `/live-tracking?vehicle=`, Revoked filter, revoke → 410); unit: nav-items, app (route + nav), admin overview card (1 active of 3); e2e T3 #3 (no Admin nav, `/admin/share-links` No access) |

## Tests
| ID | File | Result |
|---|---|---|
| F10-T1 | `src/features/share/lib/share-expiry.test.ts` | 9/9 |
| F10-T2 | `src/features/share/manage/share-dialog.test.tsx` (8) + 2 new cases in `vehicle-details-panel.test.tsx` | 10/10 |
| F10-T3 | `e2e/share-manage.spec.ts` (3 tests) | 3/3 |
| F10-T8 (F10a) | screenshots below, written by `e2e/share-manage.spec.ts` | 4 files |
| Updated | `src/app/nav-items.test.ts` (Share links item, `share.revoke` alone), `src/app/app.test.tsx` (super admin opens `/admin/share-links`), `admin-overview-page.test.tsx` (Share links card) | pass |

## Screenshots (`screenshots/`)
- `share-dialog-create.png`: Create tab with Driving · energy and trail on.
- `share-dialog-result.png`: the result view after Copy ("Copied").
- `share-dialog-links.png`: Links tab with one active link and the "Link copied" toast.
- `share-admin-links.png`: `/admin/share-links` (Active filter, regno, options, status, actions).

## Notes
- The regno column has no server field; see D-088 for how it is resolved without a mock change.
- Status (Active / Expired) uses the browser clock. A clock-shifted mock (clock project) can make a link the server sees as expired still show as Active until refresh.
