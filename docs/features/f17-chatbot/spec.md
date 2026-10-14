# F17 — Fleet Assistant (Chatbot) · Spec

| Field | Value |
|---|---|
| Status | **Draft: awaiting user sign-off** |
| Intent | `intent.md` (signed off 2026-10-14) |
| Server | The Fastify mock server is the backend: `POST /api/chat` (SSE stream), `GET /api/chat/reports/:id`. Tools call the existing REST handlers **in-process as the signed-in user**. |
| New dependencies (decisions) | `@anthropic-ai/sdk` (server only, D-105); `pdf-lib` for PDF reports (server only, pure JS, D-106). None in the browser bundle. |
| Visual source of truth | DS1 tokens + Doto. The chat panel is a right-side sheet in the F07 card style. No new look beyond that (confirmed by UAT screenshots). |
| Delivery | Two agents in the main checkout, branch `feature/f17-assistant`:<br>• **F17a** server: ports 5273/4101, D-105…D-106.<br>• **F17b** client: ports 5373/4200, D-107.<br>Disjoint files. The orchestrator commits. After F16. |

## 1. Files (kebab-case)
```
mock-server/assistant/assistant-config.ts     model, effort, max_tokens, env (ANTHROPIC_API_KEY, FMS_ASSISTANT_BASE_URL)
mock-server/assistant/system-prompt.ts        frozen system prompt (no timestamps/ids)
mock-server/assistant/assistant-tools.ts      zod-typed read-only tools (betaZodTool) → in-process API calls as the user
mock-server/assistant/assistant-runner.ts     tool runner, streaming, refusal/stop-reason handling, usage logging
mock-server/assistant/reports.ts              CSV + PDF report builders, short-lived report store (15 min)
mock-server/assistant/fake-model.ts           fake Messages API (SSE) for tests/dev without a key
mock-server/routes/assistant-routes.ts        POST /api/chat, GET /api/chat/reports/:id, POST /dev/assistant/script (dev only)
shared/contract/assistant.ts                  chat request, SSE event schemas, report descriptor
src/features/assistant/assistant-store.ts     class-based conversation state (main thread)
src/features/assistant/chat-stream.ts         fetch + SSE parser (abortable)
src/features/assistant/components/assistant-panel.tsx, message-list.tsx, composer.tsx, tool-chip.tsx, report-card.tsx
src/app/app-layout.tsx                        "Ask FMS" button in the header actions (chat.use)
```

## 2. Model and API usage (server)
- **Model:** `claude-opus-5-5`, with adaptive thinking always on and `output_config.effort` set explicitly to `"medium"`. Both are configurable in `assistant-config.ts`.
- **Refusal fallback:** `fallbacks: "default"` with the beta `server-side-fallback-2026-07-01`, so a refused request is retried on a fallback model. `stop_reason` is checked before reading content; a final `refusal` shows a polite "I can't help with that".
- **Loop:** the SDK **tool runner** (`client.beta.messages.toolRunner` + `betaZodTool`) runs the tool loop, streaming each turn. Text deltas, tool starts/ends and report links are forwarded to the browser as SSE. Parallel tool calls are allowed. Tool errors return `is_error` results, never thrown.
- **Tool choice:** `tool_choice` is `auto`; forced tool use isn't supported on this model. Tools have `strict: true` schemas, and their inputs are validated by zod before running.
- **Prompt caching:** request order is `tools` → `system` → `messages`. The tool list is fixed and sorted, and the system prompt is frozen, with top-level `cache_control: {type:"ephemeral"}`. The per-user context (name, role, fleet names in scope, today's IST date) goes in the **first user turn**, not the system prompt, so the cached prefix is shared by all users. Cache hits are verified via `usage.cache_read_input_tokens` (logged).
- **Conversation:** the client sends the full transcript (≤ 30 turns; older turns are dropped from the start, never edited in the middle). The server keeps no chat history.
- **Limits:** `max_tokens` 16000 per turn, ≤ 8 tool iterations per question, 60 s overall timeout. On 429/5xx the user sees "Assistant is busy, try again" and the SDK's own retries apply.

## 3. Tools (read-only, all scope-checked by the existing route guards)
| Tool | Backed by | Returns |
|---|---|---|
| `find_vehicles {query?, status?, fleet?, limit≤50}` | F03/F08 search + status | regno, status, fleet, last update |
| `get_vehicle {regno \| vehicleId}` | vehicle meta + latest combinfo + no-GPS insight (F14) | key metrics, location, status, driver |
| `vehicle_history {regno, from, to}` | F11 analytics series | daily KPIs |
| `find_drivers {query?, fleet?, status?}` / `get_driver {name \| id}` | F11 drivers | driver, current vehicle, open requests, KPIs |
| `list_requests {type?, status?, fleet?, from?, to?}` | F11 requests (`requests.manage` only) | requests summary |
| `fleet_summary {fleet?, from, to}` | F11 analytics summary | KPI totals |
| `create_report {kind, format: csv \| pdf, fleet?, from, to}` | `reports.ts` | `{reportId, filename, rows}`, downloaded via `GET /api/chat/reports/:id` |

**Report kinds:** `vehicle-status` (current status for each vehicle), `utilisation` (per-vehicle KPIs over a range), `driver-performance`, `no-gps` (vehicles with no GPS and their causes), `requests`. CSV uses the F09 column conventions (IST times). The PDF is A4 with a title, filters, generated-at time (IST), a table and page numbers; it's capped at 5 k rows, and larger reports suggest CSV.

**Scope:** a tool runs only if the user holds the permission the underlying route requires; otherwise it returns "not permitted" and the model explains. Out-of-scope vehicles/drivers are indistinguishable from "not found".

## 4. Client
| ID | Requirement |
|---|---|
| F17-R1 | **"Ask FMS" button** in the header (`chat.use`) opens a right sheet: 420 px on desktop, full-screen on mobile. **Contents:** suggested prompts, a message list and a composer (Enter sends, Shift+Enter adds a new line). Esc or close keeps the conversation for the session. |
| F17-R2 | **Streaming answers** render as text with simple markdown (lists, bold, tables). While tools run, chips show "Looking up MH12AB1234…". There's a Stop button (aborts the fetch, and the server cancels the request) and a retry after errors. |
| F17-R3 | Regnos and driver names in answers become links (to the map / analytics drill-down) when the server sends entity references. |
| F17-R4 | **Report cards:** a file name, row count, format badge and a **Download** button. Links expire after 15 min ("Ask again to regenerate"). |
| F17-R5 | **Clear "not configured" state:** when no API key is configured and fake mode is off, the panel says the assistant isn't set up yet (no error toast). |
| F17-R6 | All logic lives in `assistant-store.ts`, so the components stay thin. The panel is a lazy chunk that loads on first open. |

## 5. Testing without the real API (D-107)
- `FMS_ASSISTANT_BASE_URL` points the SDK at `mock-server/assistant/fake-model.ts`, a fake **Messages API** endpoint that streams scripted SSE. The real SDK, tool runner and tool code all run; only the model is canned.
- **Scripts** are chosen by a matching rule (e.g. "MH12" → a `get_vehicle` tool call then a text answer) or set per test via `POST /dev/assistant/script` (dev only).
- e2e and dev use fake mode by default. The real API is used only when `ANTHROPIC_API_KEY` is set and `FMS_ASSISTANT_FAKE` isn't `1`. A manual smoke test with a real key is listed in the test report and isn't part of CI.

## 6. Budgets
- First streamed token ≤ 1.5 s in fake mode (UI pipeline); the real model's latency is reported, not gated.
- A report of 1 lakh rows as CSV ≤ 3 s; a PDF of 5 k rows ≤ 3 s.
- The client panel chunk is ≤ 40 kB gzip, and the app shell grows by ≤ 2 kB.

## 7. Tests
| ID | Agent | Type | Test |
|---|---|---|---|
| F17-T1 | a | unit | Tool zod schemas; scope enforcement (an Operator in North can't get a vehicle from South: "not found"); a permission-gated tool returns "not permitted". |
| F17-T2 | a | unit | Reports: CSV header and rows for each kind; the PDF parses (pdf-lib reload) with the expected page count and title; the 15 min expiry. |
| F17-T3 | a | contract | `/api/chat` against the fake model: SSE event order (text deltas, tool start/end, report, done); `refusal` handling; the iteration cap; abort cancels the run; no API key and fake off → `not_configured`. |
| F17-T4 | a | unit | Prompt caching hygiene: the system prompt and tool list are byte-identical across users and requests (snapshot test); no timestamps in the prefix. |
| F17-T5 | b | component | Composer, streaming render, tool chips, Stop, report card, not-configured state. |
| F17-T6 | b | e2e | Fake mode: ask "Where is MH12…?" → a tool chip → an answer with a link to the map; ask about a driver → an answer; "Export no-GPS vehicles as CSV" → download, with the row count matching the API; the same as PDF → downloads a `.pdf`. |
| F17-T7 | b | e2e | A Viewer without `chat.use` doesn't see the button. A scope test proves out-of-fleet data never appears in an answer. |
| F17-T8 | both | e2e | UAT screenshots → `screenshots/`: the panel with an answer, tool chips, a report card, mobile, not configured. |
| F17-T9 | orchestrator | cmd | `pnpm check`, `pnpm build` (the browser bundle doesn't contain `@anthropic-ai/sdk` or `pdf-lib`), e2e (setup + chromium, then clock), perf. |

## 8. Decisions to propose
- **D-105:** the server-side Claude integration: `claude-opus-5-5`, effort `medium`, `fallbacks: "default"`, the tool runner + streaming, read-only in-process tools as the user, and a cache-friendly prompt layout.
- **D-106:** `pdf-lib` (server) for PDF reports and the 15 min report store.
- **D-107:** a fake Messages endpoint for tests/dev (`FMS_ASSISTANT_BASE_URL`), with a real key only in a manual smoke test.

## 9. Out of scope
Actions that change data, voice, persisted chat history, uploading files to the assistant, multilingual answers (English only in v1).
