# F17 — Test report

Branch `feature/f17-assistant` (main checkout). Built by two agents in parallel (F17a server on 5273/4101, F17b client on 5373/4200); the orchestrator wrote the shared contract first and integrated. Testing kept light at the user's request. **Awaiting UAT.** Details: `test-report-server.md`, `test-report-client.md`.

## Runs (2026-10-14)
| Command | Result |
|---|---|
| `pnpm check` (once) | **907/908**; the 1 failure is the known time-of-day F11-T3 replacement-engine test (`mock-server/store/requests.test.ts`, untouched) |
| `pnpm build` | pass; `assistant-panel` lazy chunk **6.5 kB gzip** (budget 40), app shell +0.45 kB (budget 2); `@anthropic-ai/sdk` / `pdf-lib` absent from every browser asset |
| F17 server tests | 29/29 (tools, scope, reports, SSE contract against the fake model, caching hygiene) |
| F17 client tests | 11 component tests; `e2e/assistant.spec.ts` 7/7 with `FMS_ASSISTANT_FAKE=1` |

## Acceptance tests
| ID | Result | Notes |
|---|---|---|
| F17-T1 | pass | Operator in North: South vehicle → "not found"; missing permission → "not permitted" |
| F17-T2 | pass | CSV per kind, PDF reload (pages/title), 15 min expiry. 1 lakh-row CSV ≈ 0.3 s, 5k-row PDF ≈ 0.65 s (budget 3 s each) |
| F17-T3 | pass | SSE order, refusal, 8-step cap, abort, `not_configured` |
| F17-T4 | pass | system prompt + tool list byte-identical across users; no timestamps in the cached prefix |
| F17-T5 | pass | composer, streaming, tool chips, Stop, report card, not-configured |
| F17-T6 | pass | regno → chip → map link; driver → analytics link; no-GPS CSV rows match; PDF downloads |
| F17-T7 | pass | Viewer: no button, 403; out-of-fleet regno never appears |
| F17-T8 | pass | `screenshots/`: panel-empty, panel-answer, tool-chips, report-card, mobile, not-configured (via a mocked `/api/chat`) |
| F17-T9 | partial | check + build once; full e2e/perf not run |

## Manual, pending
- **Real-API smoke test**: start the mock with `ANTHROPIC_API_KEY=… pnpm dev` (and without `FMS_ASSISTANT_FAKE=1`), ask a few questions, and confirm `cache_read_input_tokens > 0` from the second question on (logged as `assistant run`).

## Notes for UAT
- With no key, dev runs the **fake model** (scripted answers from rules on the question: a regno, "driver …", "export … csv/pdf", "requests", "summary").
- "No-GPS as PDF" for the whole fleet is ≈ 13 k rows, above the 5 k PDF cap: the assistant suggests CSV. Ask for one fleet for a PDF.
- Incident during the build: the server agent stopped its smoke-test server with `pkill -f "mock-server/index.ts"`, which also stopped the user's own `pnpm dev` (5173/4000). Agents are now told to stop only processes they started.
