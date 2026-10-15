# F24 — Prompt Caching Across Providers · Spec

**Status:** Draft — written with the signed-off intent (2026-10-15). Decision: D-141 (Proposed).
Also carries two F23 server items (SSE heartbeat, stream end reasons), at the orchestrator's request.

## 1. Request layout (all providers)
Order: **tools → system prompt (+ catalogue) → conversation**.
- Tools: the 16 zod tools, sorted by name, identical for every user and both chats (F17/F19 rule).
- System prompt: frozen `SYSTEM_PROMPT` (no dates, ids, names).
- Conversation: earlier turns are plain text and never change between turns.
- **Per-request context goes only in the latest user turn**, in front of the question:
  `<context>` (user, role, fleets, today's IST date, widget types), then `<dashboard>` in a dashboard chat.
  This replaces "context in the first user turn" (D-105 / F19 §2). Earlier turns carry no context.
- Guarded by a snapshot of the prefix digest (tools + system + fixed params) per wire format, plus
  equality checks across turns, users and dashboards.

## 2. Per-provider settings
| Provider | Setting | Source |
|---|---|---|
| Anthropic | Explicit `cache_control: ephemeral` on the system block (caches tools + system for every user); explicit marker on the last history message before the latest user turn (cross-turn read point); top-level automatic `cache_control` for the tool-loop tail. 3 of the 4 allowed breakpoints, all 5-min TTL. Both chats. | https://platform.claude.com/docs/en/build-with-claude/prompt-caching (via the claude-api skill: render order tools→system→messages, 4 breakpoints, 20-block lookback, automatic + explicit combine) |
| OpenAI | Automatic prefix caching (≥ 1,024 tokens). `prompt_cache_key` = `fms-` + sha256(user id + chat id)[0..16] where chat id is `global` or `d:<dashboardId>` (hashed: no ids leave the server). `stream_options.include_usage`; cached = `usage.prompt_tokens_details.cached_tokens`. No retention parameter (provider default). | https://developers.openai.com/api/docs/guides/prompt-caching |
| xAI | Automatic caching. Header `x-grok-conv-id` = the same hashed per user + chat value; cached = `usage.prompt_tokens_details.cached_tokens`. | https://docs.x.ai/developers/advanced-api-usage/prompt-caching/best-practices · https://docs.x.ai/developers/advanced-api-usage/prompt-caching/usage-and-pricing |
| xAI (flagged) | **Unverified:** the xAI docs do not say whether streamed chat completions return usage or accept `stream_options`. We send `stream_options: {include_usage: true}`; `FMS_XAI_STREAM_USAGE=0` turns it off if xAI rejects it. Unverified too: whether `prompt_cache_key` works on Chat Completions (docs name it for the Responses API) — not sent. | as above |
| Fake (both wires) | Keeps a digest set of request prefixes (per wire + model + cache key); reports the longest previously seen prefix as cached tokens (≈ chars/4). So turn 2 of any chat (and step 2 of a tool loop) reports a hit. | — |

## 3. Visibility
- One server log line per turn: `assistant turn` with `provider`, `model`, `cachedTokens`, `inputTokens`
  (all input incl. cached), `hitRate`, `iterations`, `ms`.
- `GET /api/dev/assistant/stats` adds `cache: { <provider>: { turns, inputTokens, cachedTokens, hitRate } }`
  and `streamEnds: { done, error, 'client-abort', timeout, 'provider-cut' }`.
- Usage counting: `inputTokens` (uncached) + `cacheReadInputTokens` + `cacheCreationInputTokens` = all input.

## 4. F23 server items (both chat streams)
- **Heartbeat:** an SSE comment line `: ping` every 15 s (`FMS_SSE_HEARTBEAT_MS` overrides, for tests) while the stream is open.
  Browsers' parsers ignore comment lines (the app's parser reads only `data:` lines).
- **End reason:** one log line `assistant stream ended` with `chat` (global/dashboard), `endReason`, `ms`:
  `done` · `error` (an error event was sent) · `client-abort` (client closed) · `timeout` (60 s / 90 s) ·
  `provider-cut` (the provider stream ended without a finish, or dropped after output had started).
  The OpenAI-compatible adapter now throws `ProviderCutError` when the stream ends without `[DONE]`
  or a `finish_reason` (shown to the user as "busy").

## 5. Out of scope
Response caching, semantic caching, 1-hour TTLs, OpenAI `prompt_cache_retention`.

## 6. Acceptance tests
| ID | Test |
|---|---|
| F24-T1 | Prefix snapshot: Anthropic (tools + system + fixed params) and OpenAI (tools + system message) digests match the stored snapshot and are identical for ops/superadmin, global/dashboard chat. |
| F24-T2 | Across turns: turn N+1's messages start with turn N's messages minus the latest user turn, byte for byte (both chats); `<context>` / `<dashboard>` appear only in the latest user turn. |
| F24-T3 | Anthropic request: system block carries `cache_control`; the message before the latest user turn carries `cache_control`; top-level `cache_control`; ≤ 4 markers. |
| F24-T4 | OpenAI request has `prompt_cache_key` (same for two turns of one chat, different for another user and for a dashboard chat); xAI request has the `x-grok-conv-id` header, `stream_options.include_usage`, no `prompt_cache_key`; `FMS_XAI_STREAM_USAGE=0` drops `stream_options`. |
| F24-T5 | Fake providers: turn 1 of a new chat may miss; turn 2 reports `cacheReadInputTokens > 0` on anthropic, openai and xai; dev stats show per-provider `cachedTokens > 0` and `hitRate`. |
| F24-T6 | Heartbeat: with `FMS_SSE_HEARTBEAT_MS=50`, a slow answer's raw stream contains `: ping` lines and still parses into the same events. |
| F24-T7 | End reasons: done, error (refusal), client-abort and timeout increment `streamEnds`; an OpenAI stream cut before `[DONE]` → `provider-cut`, error `busy`. |
| F24-T8 | Real-key smoke (manual, Grok): second turn logs `cachedTokens > 0`. |
