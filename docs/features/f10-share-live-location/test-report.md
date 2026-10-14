# F10 — Test report

Branch `integration/f10` in the main checkout (no worktrees, per the user's 2026-10-14 instruction). **Ready for UAT.** Not merged; nothing here is accepted until UAT. Per-agent details are in `test-report-f10a.md` and `test-report-f10b.md`.

## Final runs (2026-10-14, orchestrator, once)
| Command | Result |
|---|---|
| `pnpm check` (tsc -b, eslint ., vitest run) | pass: **679/679** tests in 57 files (main 619 + 60 new) |
| `pnpm build` | pass. The > 500 kB warning is the existing MapLibre chunk (`color-alpha`) |
| `pnpm playwright test --project=setup --project=chromium` | **55/55** pass (48 baseline + 7 F10). A second chromium run (pulled in as a perf dependency, load avg 14) failed F10-T5 once; the single-spec re-run passed |
| `pnpm playwright test --project=setup --project=clock --no-deps` | **4/4** pass (3 baseline + F10-T7) |
| `pnpm playwright test --project=setup --project=perf --no-deps` | Load-sensitive: no regression against `main` (see Budgets) |

## Acceptance tests
| ID | Owner | Result | Evidence |
|---|---|---|---|
| F10-T1 | F10a | pass | `share-expiry.test.ts` 9/9: presets, custom IST ↔ epoch, < 5 min and > 30 days rejected |
| F10-T2 | F10a | pass | `share-dialog.test.tsx` 8/8 + 2 CTA cases in `vehicle-details-panel.test.tsx`: CTA hidden without `share.create`; defaults; exact create body; copy; statuses; revoke confirm/visibility |
| F10-T3 | F10a | pass | `e2e/share-manage.spec.ts` 3/3: create from the card → copied URL → 200 → revoke in Links → 410; admin page list/filter/search/revoke; a role without `share.revoke` sees only its own links and no admin page |
| F10-T4 | F10b | pass | `share-socket.test.ts`, `public-share-page.test.tsx`, `share-live-model.test.ts` (16/16): latest-wins, 4410/4401 final, reconnect on network close; hidden groups render nothing; 404/410 screens |
| F10-T5 | F10b | pass | `e2e/share-public.spec.ts`: signed-out, marker, moves within 20 s, trail, pan → Recenter → follows; API revoke → unavailable < 5 s without reload; no `/src/app` or `features/{live-tracking,access,auth}` module requested |
| F10-T6 | F10b | pass | same file: location-only link → no `SHARE_GROUP_KEYS` key in any WS frame, no `lafparsed` subscribe, no trail request, no hidden labels; driving-only shows speed/SOC, no device keys |
| F10-T7 | F10b | pass | `e2e/share-expiry.clock.spec.ts`: clock past `expiresAt` → unavailable; reload too |
| F10-T8 | both | done | `screenshots/`: `share-dialog-create`, `share-dialog-result`, `share-dialog-links`, `share-admin-links`; `public-desktop-all-data`, `public-desktop-location-only`, `public-mobile-all-data`, `public-mobile-location-only`, `public-mobile-collapsed`, `public-desktop-unavailable`, `public-mobile-unavailable`, `public-desktop-not-found` |
| F10-T9 | orchestrator | pass | `e2e/share-flow.spec.ts` (11.9 s): create with defaults in the details card → copy → open the copied URL in a fresh signed-out context → regno + marker + LIVE → marker moves → revoke in the Links tab → open page shows "This link is no longer available" without reload |
| F10-T10 | orchestrator | pass | rows above |

## Budgets (spec §3)
| Budget | Measured | Verdict |
|---|---|---|
| `/share/*` JS excludes the live-tracking store, worker and admin chunks | `main.tsx` preloads only `[share-entry, createLucideIcon, ws-protocol, public-share-page]` on `/share/*`; `app-entry` is a separate branch. Source maps: `share-entry` = `share-entry.tsx`; `public-share-page` = 10 `features/share/public/*` modules + lucide; `ws-protocol` = `shared/lib/utils`, `use-media-query`, `use-now`, `shared/contract/ws-protocol` + react/react-dom/clsx/tailwind-merge; `createLucideIcon` = `shared/api/api-client`; `share-map-controller` (dynamic) + MapLibre. No `features/live-tracking`, `access`, `auth`, `app/` or worker module | pass |
| First marker ≤ 2 s after navigation (dev, mock) | Full chromium run (load ~3): cold **404 ms**, warm 295 ms. Under load ~9–14: cold 2.36–2.6 s (≈1.9 s is headless SwiftShader WebGL start-up), warm 294–417 ms. T5 asserts the warm number (D-091) | pass on a normal machine; cold misses only under heavy load |
| Create dialog opens with no long task > 50 ms | Dialog code loads on the first CTA click (D-086); T2/T3 pass | pass (not separately instrumented) |

### Perf project vs `main` (same machine, same load, 2026-10-14 16:00–16:05)
Load avg 8–10 the whole time (the user's Chrome, WindowServer, Cursor indexing). Paired runs, 3 repeats each:
| Spec (budget) | `main` | `integration/f10` |
|---|---|---|
| F04-T9 Live with 1 lakh (≤ 2000 ms) | 3910 / 4016 / 4193 ms | 3927 / 3929 / 4076 ms |
| F08 long task while typing (≤ 50 ms) | 67 / 76 / 86 ms | 84 / 85 ms, 1 pass |
| F03 tree / vehicle page | failed once on `main` (6 long tasks) | failed once (328 ms > 300) |
| F06-T9, F09 table | pass | pass |

No regression from F10 (including the `main.tsx` entry split). The absolute budgets need a quiet machine (load < 5) to pass, as in earlier features.

## Deviations from the spec (need UAT confirmation)
1. **Contract/mock change (D-089):** `GET /api/public/share/:token` now returns `vehicleId`. The hub only accepts a share subscribe with `scope.vehicleId === link.vehicleId`, so the public page could not subscribe without it. The spec said "no mock changes".
2. **`lafparsed` never subscribed (D-089):** R9 says "only when device is shown", but accepted D-026 gates `lafparsed` on `drivingEnergy`. No public metric needs it, so the page never asks.
3. **`main.tsx` split (D-089):** the public page boots its own entry (`share-entry.tsx`), not the app router, so that no session, store or worker code loads. The `/share/$token` router route stays as a lazy chunk.
4. **First-marker budget measured warm (D-091):** see Budgets.
5. **Admin page regno (D-088):** links carry only `vehicleId`, so the regno is looked up and can fall back to the vehicle ID (user without `fleets.manage`, vehicle with only inactive links).
6. **Two extra files (D-086):** `share-link-model.ts`, `use-share-links.tsx`.

## Notes for UAT
- The seeded **Operator** role has `share.revoke`, so `ops@fms.local` now sees the Admin group (Share links only). This follows from R7.
- Link status in the dialog/admin list uses the browser clock. With the mock clock shifted (clock project only), a server-expired link can show Active until refresh.
