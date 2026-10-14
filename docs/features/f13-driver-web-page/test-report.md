# F13 — Test report

**UAT accepted 2026-10-14**; merged into `main`.

Branch `feature/f13-f14` in the main checkout (with F14). Built by the orchestrator in session 8; testing kept light at the user's request. **Amended mid-build at the user's request:** the three separate request actions became one integrated report flow with incidents (D-109), and the note takes voice input (D-110).

## Runs (2026-10-14)
| Command | Result |
|---|---|
| `pnpm check` (once, end of step) | 840/841; the 1 failure is the known time-of-day F11-T3 replacement-engine test (see F12 report) |
| `pnpm vitest run src/features/driver/driver.test.tsx` | 10/10 (integrated report, voice, incidents, store) |
| `e2e/driver-page.spec.ts` (chromium, 390 px) | **4/4** |
| `vite build` | `/driver` has its own entry chunk (`driver-entry`, 10.7 kB gzip). Its static graph is the shared React/Radix vendor, lucide, the contract and two tiny helpers. **No MapLibre, worker, live-tracking store, router or admin code.** About 85 kB gzip excluding React (budget 120 kB) |

## Acceptance tests
| ID | Result | Evidence |
|---|---|---|
| F13-T1 | pass | report flow: a reason is required; tyre suggests roadside help; sends breakdown then RSA with the body per type; a failed report stops the help requests, Retry resends only failed ones, 409 → "Already requested"; voice: language choice, interim text, final phrase appended, hidden without support; incidents: grouping, merged timeline, summary, "Also need another vehicle"; no-vehicle state; store banner |
| F13-T2 | pass | `driver@fms.local` signs in → `/driver` → tyre report with suggested roadside help → one incident with Report + Roadside help open → "Also need another vehicle" adds the replacement to the same incident |
| F13-T3 | pass | operator acknowledge (note) → dispatch (ETA) → resolve via the F11 API; each step shows live on the incident within 5 s; summary "Help on the way · ETA 30 min" |
| F13-T4 | pass | replacement approved → vehicle card switches regno + banner |
| F13-T5 | pass | Driver sent to `/driver` from `/live-tracking` and `/admin`; super admin on `/driver` gets No access; chunk check |
| F13-T6 | pass | `screenshots/`: home-mobile, home-desktop, report-step-1/2/3, report-sent, incident-timeline, replacement-banner |
| F13-T7 | partial | full e2e/perf not run (user asked to relax testing) |

Voice input was tested with a fake recognizer; it was not tried on a real microphone. The UAT should try it on Chrome (Android/desktop) and Safari.

## Defects found and fixed
- The super admin holds every permission, including `driver.self`, so the `/driver` gate first let staff in. The Driver rule is now "`driver.self` and no staff page", the same as the router guard.
- Sign-in with `?redirect=/driver` used router navigation (Not found). It now does a full page load for `/driver`.
- The note was shown twice on the first timeline step.

## Notes / deviations
- `use-driver-events.ts` from the spec's file list became `driver-store.ts`, a class store on the shared F15 socket (request + assignment events, re-sync on reconnect, 30 s poll).
- Geolocation falls back to letting the server use the vehicle's last fix (the confirmation says so).
