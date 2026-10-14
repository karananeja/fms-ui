# F14 — Test report

Built in the main checkout on `feature/f13-f14`, alongside F13 (disjoint files), ports 5373/4200. **Awaiting UAT.**

## How it was delivered
One agent built the desk store, API client, desk page and drawer (replacement panel, RSA form, lazy map snippet), the nav item with its live badge, the auto-assign toggle (desk header and F03 fleet detail), the no-GPS insight section in the F07 card, and the notification-link change. Testing was relaxed on the user's request: targeted vitest and one e2e spec only. The full `pnpm check`, `pnpm build` and full e2e (F14-T8) are left for the orchestrator's single end-of-step run.

## Runs (2026-10-14)
| Command | Result |
|---|---|
| `pnpm vitest run src/features/requests src/app src/features/notifications src/features/access src/features/live-tracking/components src/features/drivers` | **172/172** (18 files) |
| `pnpm typecheck` | clean for F14 files. The only errors are in F13's in-progress `src/features/driver/driver.test.tsx` (modules not written yet) |
| `pnpm eslint` on the F14 dirs + `e2e/requests.spec.ts` | clean |
| `e2e/requests.spec.ts` (setup + chromium, 5373/4200) | **6/6** (setup + 5 tests), 19 s, passed twice in a row |

## Acceptance tests
| ID | Result | Evidence |
|---|---|---|
| F14-T1 | pass | `requests/request-desk-store.test.ts` (7): paged load, newest first, open states by default, open count; type / status / fleet-subtree / reg no + driver filters; live insert, update, removal from the filtered set, stale event ignored, highlight expiry; reconnect re-load, release unsubscribes, no load without `requests.manage`; state machine per type; dispatch validation; notification links |
| F14-T2 | pass | `requests/requests.test.tsx` (12): valid actions per state (6 cases); note + 409 refresh message; RSA form validation then dispatch; replacement suggested (Approve), waiting text + override by search with the server's 409 reason, override from the candidate list, "Assigned automatically" in panel and timeline |
| F14-T3 | pass | A new driver user (invite → accept) reports a breakdown; the row appears within 5 s with highlight; nav badge shown; acknowledge with note; "Suggest replacement" lists candidates; the driver asks for a replacement; the breakdown drawer links to it; Approve → `assigned`; API: `GET /api/driver/me` as the driver shows the new vehicle |
| F14-T4 | pass | RSA: Dispatch hidden until acknowledged; empty-form validation; dispatch "Tow team 7", 40 min; resolve; timeline has 4 steps (reported, acknowledged by You, dispatched, resolved + note). Override with the request's own vehicle → "Vehicle is not available"; then reject |
| F14-T5 | pass | Desk fleet filter → toggle shows "Inherited from a parent fleet" → on → "Set on this fleet"; the driver's new replacement arrives already `Assigned`; timeline + panel say "Assigned automatically"; the same toggle shows on in `/admin/fleets` detail; the override is cleared afterwards |
| F14-T6 | pass | A signal-derived no-GPS vehicle shows the cause (matches the server's `likelyCause`), "since" in IST and 4 chips with live values (battery V, signal dBm); a driver on a no-GPS vehicle reports `no-gps-device` → cause `driver-reported`, "GPS device not working" and "View request" opens the drawer |
| F14-T7 | pass | `screenshots/`: desk, desk-mobile, drawer-breakdown, drawer-replacement, drawer-rsa-dispatch, drawer-rsa, drawer-override-error, drawer-auto-assigned, drawer-mobile, auto-assign-toggle, auto-assign-fleet-detail, no-gps-insight-signals, no-gps-insight-reported, no-gps-insight-mobile. Also checked: a request notification opens `/requests/$id` |
| F14-T8 | not run | Left for the orchestrator (one `pnpm check` + `pnpm build` + e2e at the end) |

## Defects found and fixed
- The table header's screen-reader-only "Type" cell left the grid flow, so every header sat one column to the left. It is now an empty cell with hidden text.
- Replacement candidates in the 420 px drawer cut off the "Suggested" tag. Each candidate is now two lines: the reg no with the tag, then distance, SOC, range and status.
- The SidePanel's own close button is also named "Close", so the footer actions have `data-testid="action-<name>"`.
- On mobile the vehicle card remounts as a bottom sheet; the e2e waits for the section again after a resize.

## Deviations
- **Reg no and driver names:** F11 requests carry ids only, and the Operator role has no `drivers.manage` / `fleets.manage`. Reg nos come from the live worker (`liveTrackingStore.vehicleSummary`, the same source as F12). Drivers come from `GET /api/drivers/:id` with `drivers.manage`, else from `GET /api/vehicles/:id/driver` on the request's vehicle or its replacement, matched by id. Search by reg no or driver therefore works once these labels have loaded. Without `live.view` the vehicle id is shown instead.
- **"Suggest replacement" on a breakdown** is a read-only preview. Approve and override are only valid on a replacement request (F11 §2), so the preview links to the driver's open replacement request when there is one.
- **Override search** uses the live worker's reg-no prefix search. Eligibility (free, in scope) is left to the server, whose 409 reason is shown.
- **The status filter** has "Open requests" (default), "All statuses" and each status. There is no age filter: the spec lists type, status and fleet, and rows are newest first with an Age column.
- **The desk loads every request in scope** (pages of 500) and filters in memory. That keeps the badge, live merge and filters consistent; volumes are small (memory-only mock).
- `src/app/app-layout.tsx` (not on the ownership list) gained two lines to render a nav item's optional `badge`.
