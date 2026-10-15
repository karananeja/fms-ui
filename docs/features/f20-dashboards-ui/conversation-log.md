# F20 — Dashboards Route & UI · Conversation log

## 2026-10-15 — implementation (F20 agent, shared branch `feature/part3-f19-f20`)
**User (via orchestrator):** "Implement F20 per the signed-off spec … spike F20-T1 first … no worktrees, no commits; ports 5373/4201." Mid-task: "speed up F20, prioritise the core end to end, at most 4 shots; hand back as soon as the core works."
**Assistant:** Spike T1 passed (RGL 2.2.4 `Responsive` under React 19 StrictMode, no console errors, resize works in jsdom; mouse drag proven in Playwright). Built the worker `queryWidgets` (D-129), routes/nav/permission, `/dashboards` list + empty state, `/dashboards/$id` with grid, 8 widget renderers, title bar, share dialog, `DashboardSession` save queue (D-130), query cache (D-131), live source and the chat dock on F19's `useDashboardChat` (D-132), keyboard arrange (D-133).
Deviations: `lg` container threshold 940 px / `md` 600 px (§17 Q2: 1440 px + dock stays lg); RGL `Responsive` takes `rowHeight`/`margin` props (no `gridConfig`); driver-list shows phone instead of current vehicle (no bulk assignment endpoint) and rows open `/admin/drivers` (no driver deep link exists).
**Status/Next:** Core done; deferred items listed in `test-report.md`. Awaiting orchestrator full check and UAT.
