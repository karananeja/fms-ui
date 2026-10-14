# F17a: Fleet Assistant server · Test report

| Field | Value |
|---|---|
| Date | 2026-10-14 |
| Branch | `feature/f17-assistant` (not committed by the agent) |
| Scope | F17-T1…T4 (agent "a"): `mock-server/assistant/*`, `mock-server/routes/assistant-routes.ts` |
| Commands | `pnpm vitest run mock-server/assistant mock-server/tests/f17-assistant.test.ts`, `pnpm typecheck`, `pnpm eslint mock-server shared` |
| Result | **29/29 passed** (19 in `f17-assistant.test.ts`, 10 in `reports.test.ts`); typecheck clean; lint clean |

## Tests
| ID | File | What it checks | Result |
|---|---|---|---|
| F17-T1 | `mock-server/tests/f17-assistant.test.ts` | The 8 tools are sorted, `strict: true`, `additionalProperties: false`, and zod rejects bad input. An Operator in North gets a North vehicle; a vehicle outside North reads exactly like an unknown regno ("not found"), also for `vehicle_history`. `find_vehicles` / `find_drivers` results stay in scope; a fleet outside scope is "not found". A Viewer gets "not permitted" for `fleet_summary`, `list_requests` and the utilisation report; the Driver role for `get_vehicle`. Tool runs emit `tool_start` (label "Looking up MH12…") and `tool_end`. | Pass |
| F17-T2 | `mock-server/assistant/reports.test.ts` | CSV header and rows for each of the 5 kinds (scope applied, RFC 4180, CRLF); vehicle-status row count = vehicles in scope; IST time format `DD MMM YY \| HH:mm:ss`; no-gps rows all have a cause; the PDF reloads with pdf-lib with the right title and page count; > 5k rows is refused; the store is owner-only and expires after 15 min. | Pass |
| F17-T3 | `mock-server/tests/f17-assistant.test.ts` | `/api/chat` against the fake model, over real HTTP: 401/403/422 guards; SSE order `tool_start → tool_end → text… → entities → done` with cache usage; an out-of-scope regno ends in `tool_end ok:false "Not found"` and no entity; the wire request carries model/thinking/effort/fallbacks/beta/top-level `cache_control`/`tool_choice: auto`; CSV and PDF reports (report event, owner-only download, `content-type`, `content-disposition`, row count = CSV lines); refusal → `error refusal` (no `done`); 429 → `busy`, 400 → `failed`; the loop script stops at 8 tool calls with `done stopReason: max_iterations`; explicit `steps` scripts with `{{result}}`; a client abort cancels the run (fake stream cut, no active runs); `FMS_ASSISTANT_FAKE=0` and no key → only `error not_configured`. | Pass |
| F17-T4 | `mock-server/tests/f17-assistant.test.ts` | The tool definitions (ops vs Super Admin) and the request prefix hash the same; tool names are sorted; no dates, epoch numbers, user names, ids or fleet names in the system prompt and tools; the per-user context is only in the first user turn, and leading assistant turns are dropped. | Pass |

## Budgets (spec §6)
| Budget | Measured | Limit |
|---|---|---|
| CSV, 1 lakh rows (vehicle-status, build + serialise) | ~306 ms | ≤ 3 s |
| PDF, 5 k rows (A4 landscape) | ~647 ms (1.7 MB) | ≤ 3 s |
| First streamed token, fake mode | effectively immediate (tests run in < 1 s total) | ≤ 1.5 s |

## Manual checks
- Live smoke test on `MOCK_PORT=4101` (`FMS_ASSISTANT_FAKE=1`): driver question, no-GPS PDF export, download returns `%PDF-1.7` with `attachment; filename="no-gps-….pdf"`.
- **Real API smoke test (not in CI, pending):** run the mock with `ANTHROPIC_API_KEY=… FMS_ASSISTANT_FAKE=0 pnpm mock`, ask "Where is <regno>?", "Export no-GPS vehicles as CSV", and check the `assistant run` log line shows `cacheReadInputTokens > 0` from the second question on. If it stays 0, check whether the prefix (system prompt + tools, roughly 2k tokens) is below the model's minimum cacheable length.
