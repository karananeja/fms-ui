# F24 — Prompt Caching Across Providers · Test report

**Date:** 2026-10-15 · **Branch:** `feature/f22-persist-admin-data` (shared checkout, uncommitted)

## Targeted runs
| Command | Result |
|---|---|
| `pnpm vitest run mock-server/tests/f24-prompt-caching.test.ts` | 13/13 pass |
| `pnpm vitest run` f17-assistant, f19-dashboard-chat, f19-previews, f21-providers, f24-prompt-caching, `mock-server/assistant` | 7 files, 103/103 pass |
| `npx tsc -b` | clean |
| `npx eslint` + `npx prettier --check` on the F24 files | clean |

## Acceptance tests
| ID | Result | Notes |
|---|---|---|
| F24-T1 | Pass | Anthropic / OpenAI / xAI prefix digests identical for ops, superadmin and dashboard chats; snapshot in `mock-server/tests/__snapshots__/f24-prompt-caching.test.ts.snap`. |
| F24-T2 | Pass | Global and dashboard transcripts: turn N+1 starts with turn N minus the latest user turn; `<context>` / `<dashboard>` only in the latest turn. |
| F24-T3 | Pass | System block marker, history-end marker, top-level `cache_control`; ≤ 4 markers (both chats). |
| F24-T4 | Pass | OpenAI `prompt_cache_key` per user + chat (hashed); xAI `x-grok-conv-id`, usage requested, `FMS_XAI_STREAM_USAGE=0` drops it. |
| F24-T5 | Pass | Fake anthropic / openai / xai: turn 2 cached > 0, turn 3 > turn 2 (history read); dev stats per provider with `hitRate`. |
| F24-T6 | Pass | `: ping` lines at `FMS_SSE_HEARTBEAT_MS=25`; events still parse. |
| F24-T7 | Pass | `streamEnds` counts done, error, client-abort, provider-cut (anthropic + openai cut scripts → `busy`); timeout and provider-cut also unit-tested on `runChat`. |
| F24-T8 | Pending | Real-key Grok smoke test (manual): follow-up turn should log `cachedTokens > 0`. |

## Changed existing tests
- F17-T4 / F19 / dashboard-tools: context now in the latest user turn (D-141); Anthropic `system` is a block with `cache_control`.
- F21-T3: xAI requests now carry `stream_options.include_usage`.

Not run: full `pnpm check`, build, e2e (orchestrator runs them once at the end).
