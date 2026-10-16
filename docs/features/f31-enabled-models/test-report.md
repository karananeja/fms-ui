# F31 — Enabled models & chat model picker · Test report

**Date:** 2026-10-16 · branch `feature/f31-enabled-models`

| Test | Where | Result |
|---|---|---|
| F31-T1 migration v17 backfill (F25 key keeps its model) | `mock-server/tests/f25-user-api-keys.test.ts` | Pass |
| F31-T2 save without model; model in body → 422; rejected key not stored; no key in responses | same | Pass |
| F31-T3 enable (available only, ≤ 20, first enable = choice, audit), refresh drops gone models, replace keeps enabled, rate limit | same | Pass |
| F31-T4 choice: not enabled → 422; disable / remove moves it; default assistant only while allowed; next chat turn uses the chosen wire + model (F30 usage row) | same | Pass |
| F31-T5 status `options`, `serverOption`, `no_models_enabled` | same | Pass |
| F31-T6 settings page (component) | `src/features/settings/ai-keys-page.test.tsx` | Pass |
| F31-T7 model picker (component) | `src/features/settings/components/model-picker.test.tsx` | Pass |
| F31-T8 e2e: save key, enable 2, pick in Ask FMS, same in dashboard dock, disable → choice moves; rejected key not saved | `e2e/f25-user-api-keys.spec.ts` | Pass |

- **Targeted e2e (chromium):** f25, f23, dashboard-builder, assistant, d158 and f28 specs: all passed.
- **`pnpm check`:** typecheck and lint clean (0 errors). vitest 1312/1313; the one failure is the known `widget-query.perf` flake under load (load average 10), which passes alone.
- **`pnpm build`:** clean.
- **Not run:** full e2e and perf (the change doesn't touch the live pipeline budgets).
