# F23 — Conversation log

## 2026-10-15/16 — Build (agent, alongside F22 and F24)

**User (via coordinator):** "Implement F23 from the signed-off intent: richer cards (all three kinds), chat progress row, build skeletons, hide Ask FMS on the dashboard page, back button keeping list state, list upgrade, Interrupted + Retry in both chats."
Additions during the build:
1. "The page for a new/empty dashboard looks too simple" → rich starter (hero, grouped chips, templates, how-it-works, ghost tiles), permission-filtered.
2. Prompt suggestions as the user types (templates + vehicle/fleet completion, keyboard and ARIA).
3. "There is a scroll issue in the dashboard screen" → measured at 3 viewports; added edge auto-scroll while dragging/resizing; e2e guard.
4. No dock on a new dashboard; the first prompt slides it in; reload keeps it.

**Assistant:** Wrote `spec.md` (R1–R15, F23-T1…T14), implemented in `src/**` only (no contract/server/dependency changes), added `chat-ux.test.tsx` and `e2e/f23-chat-dashboard-ux.spec.ts`. Card thumbnails read each dashboard lazily (no summary field in the contract). Three proposed decisions are listed in the spec for the decision log.

**Status/Next:** Implemented and tested (see `test-report.md`). Awaiting UAT; decisions Proposed.
