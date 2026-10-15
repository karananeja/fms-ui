# F24 — Prompt Caching Across Providers · Intent

**Status:** Signed off: 2026-10-15 (user: Q5 build alongside F22)

## Why
Every turn re-sends the same long prefix (system prompt, widget catalogue, 16 tool schemas). Caching it cuts latency and cost on every provider.

## What
- **One stable prefix for all providers:** tools in a fixed sorted order, then the system prompt and catalogue (no dates or ids), then the conversation. Per-request context (user scope, `<dashboard>` snapshot, date) goes only in the latest user turn. A snapshot test guards the prefix bytes.
- **Anthropic:** `cache_control` breakpoints on the tools/system prefix and on the rolling conversation (already partly there; verify and extend to dashboard chats).
- **OpenAI:** automatic prefix caching, plus `prompt_cache_key` per user and chat, so turns route to the same cache.
- **xAI Grok:** automatic caching, plus a stable conversation id header per chat (per xAI docs; verified against the docs during the spec); request usage so cache hits are visible.
- **Visibility:** dev stats (`/api/dev/assistant/stats`) and the server log show `cached / input tokens` per turn and the hit rate per provider.

## Out of scope
Response caching (same question → stored answer), and semantic caching.

## Done when
- Unit snapshot: the prefix is byte-identical across turns, users and dashboards.
- The fake providers report cache hits from the second turn on.
- The real-key smoke test (Grok) shows cached tokens > 0 on a follow-up turn.
