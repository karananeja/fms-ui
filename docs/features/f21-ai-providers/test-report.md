# F21 — Test report

Branch `feature/part3-f19-f20` (main checkout, shared with F20, disjoint files). No ports used: every test runs the in-process mock server on a random port with the fake model (`FMS_ASSISTANT_FAKE=1`).

## Runs (2026-10-15)
| Command | Result |
|---|---|
| `pnpm vitest run mock-server/tests/f17-assistant.test.ts mock-server/tests/f19-dashboard-chat.test.ts mock-server/tests/f21-providers.test.ts mock-server/assistant` | **80/80** (5 files; F17/F19 unchanged and green) |
| `pnpm vitest run mock-server/build-server.test.ts mock-server/tests/rest-contract.test.ts` | 7/7 |
| `tsc -p tsconfig.node.json --noEmit` | clean |
| `eslint` + `prettier --check` on F21 files | clean |
| full `pnpm check`, `pnpm build`, e2e | not run (orchestrator's single end run) |

## Acceptance tests
| ID | Result | Where / notes |
|---|---|---|
| F21-T1 | pass | `mock-server/tests/f21-providers.test.ts`: 17-row `assistantEnv` matrix (dev/prod no key, `FAKE=0`, empty `.env` values, `FAKE=1` over a real key, fake over the xai wire, `provider=fake`, auto-pick anthropic → openai → xai, anthropic default model, explicit provider wins, missing key, missing model for xai/openai, unknown provider, base URL) |
| F21-T2 | pass | same file: 15 tools → `tools[].function` (snapshot in `mock-server/tests/__snapshots__/`), no `$schema`, `strict: true` only for OpenAI and only where the schema qualifies (all-required + `additionalProperties: false`; today `remove_widget`); widget tools keep the strict-safe schema (no bounds/`pattern`, `anyOf`); xAI gets no `strict` |
| F21-T3 | pass | same file, `/__fake-openai/v1/chat/completions` (real SSE chunks, split `tool_calls` argument deltas, usage chunk, `[DONE]`): request shape (system message, function tools, transcript with `tool` messages); vehicle question, CSV report (+ download), global create-dashboard (3 widgets), dashboard chat build 3 → change ranking to 30 days → remove → undo — each compared with the Anthropic path on the same server (identical event sequences); refusal / busy / failed codes; 8- and 12-step caps; invalid widget → tool error; client abort cancels the upstream stream; xai variant; missing model → `not_configured` with a log line |
| F21-T4 | pass | out-of-scope regno → `Not found` chip, no entities, the `tool` message holds only the not-found error; `find_vehicles` (50) results sent to the model are all in the user's fleets; `fleet_summary` for another region → not found |
| F21-T5 | **pending (manual)** | needs the user's `XAI_API_KEY`: set `FMS_ASSISTANT_PROVIDER=xai`, `XAI_API_KEY`, `FMS_ASSISTANT_MODEL` (e.g. `grok-4`) in `.env`, `pnpm dev`; ask a vehicle question, a CSV report, build a dashboard and refine it. Check the `assistant run` log line (`provider: xai`) |
