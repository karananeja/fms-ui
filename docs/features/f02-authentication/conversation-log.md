# F02 — Conversation log

## 2026-10-13 — Intent
User signed off the intent (sign in, forgot/reset, accept invite, sign out, guards, 401 → `/login`, WS closed on logout; password policy D-018).

## 2026-10-14 — Spec
Spec drafted and signed off by the user (R1…R13, T1…T12, look proposal §4; decision IDs D-075…D-078 reserved).

## 2026-10-14 — Implementation (agent, worktree `../fms-ui-f02`)
**Done:**
- `shared/api/api-client.ts` (typed `ApiError`, 401 hook except login); live-tracking REST calls moved onto it.
- `features/auth/session`: `SessionStore`, `use-session` (context + `useSyncExternalStore`), `safe-redirect`.
- Screens: sign in, forgot, reset, accept invite (lazy route chunks), shared `auth-layout` (CSS street grid + vignette, glass card), password field, rules checklist from `passwordSchema`, user menu (rail popover, drawer block).
- Router guards via router context; layout leaves for `/login` when the session ends; `bootstrap-live-tracking` follows the session; `dev-session.ts` removed.
- e2e: setup project + storageState, fixture fallback for `--no-deps`, `auth.spec.ts`, `auth.clock.spec.ts`; three existing specs adjusted for the removed dev sign-in.

**Deviations / decisions (Proposed):** D-075 (no react-hook-form; 422 / 410 status mapping), D-076 (session mechanics, notices, cache reset, lazy chunks, email-only prefill), D-077 (e2e auth setup, T12 split into two invocations, existing spec fixes), D-078 (T9 evidence).

**Results:** see `test-report.md` — check 521/521, build clean + no leaks, e2e chromium 36/36, clock 3/3, perf 5/5.

**Screenshot review:** desktop 1280 and mobile 390 reviewed; fixed the invite expiry format. Awaiting UAT.
