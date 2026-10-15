# F24 — Prompt Caching Across Providers · Conversation log

## 2026-10-15 — Spec and implementation (agent, in parallel with F22/F23)

**User (via orchestrator):** "Implement F24 … First write a SHORT spec … then implement: byte-stable prefix, Anthropic breakpoints for both chats, OpenAI prompt_cache_key per user+chat, xAI conversation-id header + usage, cache stats per provider in dev stats + one server log line per turn. ALSO for F23: an SSE heartbeat comment line (`: ping`) every 15 s on both chat streams, and log why each stream ended."

**Assistant:**
- Checked the docs: Anthropic caching through the claude-api skill; OpenAI `prompt_cache_key` and `usage.prompt_tokens_details.cached_tokens` (developers.openai.com prompt-caching guide); xAI `x-grok-conv-id` and `cached_tokens` (docs.x.ai prompt-caching best practices, usage and pricing). The xAI docs do not cover streaming usage, so `stream_options.include_usage` is sent but switchable (`FMS_XAI_STREAM_USAGE=0`) and flagged in the spec.
- Wrote `spec.md` (Draft) and D-141 (Proposed).
- Moved `<context>` from the first to the latest user turn in both chats, so earlier turns never change. Anthropic: system-block breakpoint, a breakpoint on the message before the latest user turn, plus top-level automatic caching. OpenAI/xAI: hashed per user + chat key (body key or header).
- The fake model now keeps a prefix-digest cache and reports real-looking cached tokens (hits from turn 2; history hits from turn 3). Added a `cut` fake script.
- `runChat` returns the outcome with an end reason; routes log `assistant stream ended` and count end reasons and per-provider cache totals in `/api/dev/assistant/stats`; `: ping` every 15 s.
- Tests: new `f24-prompt-caching.test.ts` (13); updated F17/F19/F21 expectations.

**Status/Next:** Implemented and tested (targeted). Needs: spec sign-off, D-141 approval, `README.md` / `.env.example` lines for `FMS_XAI_STREAM_USAGE` and `FMS_SSE_HEARTBEAT_MS` (files owned by F22 in this session), and the real-key Grok smoke test (F24-T8).
