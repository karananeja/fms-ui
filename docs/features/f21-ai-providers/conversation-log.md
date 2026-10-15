# F21 — AI Provider Choice · Conversation log

## 2026-10-15 — implementation (F21 agent, parallel with F20)
**User (via orchestrator):** "Implement F21 per the approved spec and D-134: `openai` and `xai` through one fetch-based OpenAI-compatible adapter, anthropic unchanged, same browser SSE events, a fake OpenAI endpoint for F21-T3/T4; no new dependencies, no worktrees/commits."

**Assistant:**
- `assistant-config.ts`: `assistantEnv` now resolves provider + model (+ `reason` when not configured); empty env values count as unset; `FMS_ASSISTANT_FAKE=1` with `FMS_ASSISTANT_PROVIDER=openai|xai` runs the fake over the OpenAI wire.
- `provider.ts`: small `ChatProvider` interface (`run` the tool loop of one turn, `classify` errors). `anthropic-provider.ts`: the existing SDK tool runner moved as-is (`requestPrefix` re-exported from the runner). `openai-provider.ts`: fetch + SSE parser, `tool_calls` delta accumulation, parallel tool runs through the same runnable tools (`runRunnableTool`), failed results prefixed `Error: `, retries on 429/5xx/network before streaming, `strict` for OpenAI only where the schema qualifies.
- `assistant-runner.ts` / `dashboard-chat.ts`: provider-neutral (`provider` instead of `client`, `ChatMessage` transcript); error mapping unchanged.
- `fake-model.ts`: one neutral planner for both wires; new `POST /__fake-openai/v1/chat/completions`.
- Routes: build the provider per request; log each not-configured reason once (`Assistant not configured: …`); dev stats show `provider`.
- README "AI assistant providers" section; tests in `mock-server/tests/f21-providers.test.ts`.

**Status/Next:** F21-T1…T4 green (80/80 with F17/F19). F21-T5 needs the user's Grok key. D-134 stays Proposed until UAT.
