# F18 — Dashboard Store & Contract · Conversation log

## 2026-10-15 — implementation (agent, branch `feature/part3-ds3-f18`, main checkout, ports 5373/4201)
**User (via orchestrator):** "Implement F18 per the signed-off spec (§12 overrides); keep the store usable by F19/F20; DS3 runs in parallel on src/ and e2e/; no worktrees, no commits."

**Assistant:**
- Contract `shared/contract/dashboards.ts`: limits, 8-type widget catalogue (strict discriminated unions; nested unions for `kpi.source` and `ranking.entity`, so `score` is drivers-only by type), `WIDGET_TYPES` / `WIDGET_PERMISSIONS` / `widgetPermission()` / `WIDGET_SIZES`, lg/md/sm layout + `layoutIssues()`, resources, bodies, thread/change-set schemas. `dashboards.use` added ("Use dashboards"); Operator role gets it; role editor Insights group lists it.
- `mock-server/db/` (`openDatabase`, append-only `MIGRATIONS`, `transaction`), `mock-server/store/dashboards.ts` (store + `normaliseLayout`), `mock-server/routes/dashboard-routes.ts` (§5), wiring in config/context/build-server/harness. `MOCK_DB`, default `mock-server/data/fms.db` (git-ignored), `:memory:` in the harness and whenever `VITEST` is set.
- `mock`, `mock:once`, `perf:mock` scripts pass `--disable-warning=ExperimentalWarning` (spec §11 option).
- Tests: `shared/contract/dashboards.test.ts` (T1), `mock-server/db/database.test.ts` (T2), `mock-server/tests/f18-dashboards.test.ts` (T3–T10). See `test-report.md`.

**Status/Next:** Implemented and tested (server + contract). e2e not run by this agent (DS3 owns e2e/playwright config). Ready for orchestrator commit and UAT; F19/F20 build on the store API.
