# F14 — Conversation log

## 2026-10-14 — Implementation
- **Orchestrator → agent:** build F14 per the signed-off spec in the main checkout, in parallel with F13 (disjoint files, ports 5373/4200). Reuse the F15 events socket and the F12/F03/F07 patterns. No mock or contract changes. Relaxed testing (T1/T2 compact, one e2e spec). No commits.
- **Agent:** built the API client, the `RequestDeskStore` (main thread, live from `events`, in-memory filters, open count, highlights), the `/requests` desk and `/requests/$requestId` drawer routes, the "Requests" nav item with a live badge (after Live tracking; `ROUTE_PERMISSIONS` + No access label), the drawer (details, driver with call, lazy MapLibre snippet, timeline, state-machine actions with notes, 409 refresh), the replacement panel (suggested / waiting / override, breakdown preview), the RSA dispatch form, the per-fleet auto-assign toggle (desk header + F03 fleet detail, with inheritance), the "Why no GPS?" section in the F07 Overview tab, and notification links to the request. Tests: F14-T1/T2 (19 unit/component), `e2e/requests.spec.ts` T3–T7 (5 tests, 14 screenshots). Fixed four defects found by the screenshots and e2e (see the test report). Proposed D-101 and D-102.

**Status:** implemented and tested (targeted). **Next:** the orchestrator runs `pnpm check`, `pnpm build` and e2e once, then UAT.
