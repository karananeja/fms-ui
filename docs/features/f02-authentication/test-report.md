# F02 — Test report

Branch `feature/f02-authentication` (worktree `../fms-ui-f02`, ports 5273/4100). **Ready for UAT.** Not merged; D-075…D-078 are Proposed until UAT.

## Final runs (2026-10-14)
| Command | Result |
|---|---|
| `pnpm check` (tsc -b, eslint ., vitest run) | pass — **521/521** tests, 44 files, 0 lint warnings (+61 F02 tests, +5 app-shell guard tests) |
| `pnpm build` | pass; main chunk 683.8 kB (212.8 kB gzip) vs 688.4 kB before F02 — the auth screens are lazy chunks (≤ 4 kB each + 88 kB shared forms/zod chunk; 796 kB main if eager, D-076); worker 77.8 kB |
| Leak scan of `dist/` for `__fmsMap`, `__fmsLive`, `dev-session`, `devSignIn`, `VITE_DEV_LOGIN`, `superadmin@fms.local`, `Admin@123` | none; `src/app/dev-session.ts` deleted |
| `playwright test --project=setup --project=chromium --no-deps` | **36/36** pass (setup + 35, incl. 7 F02 specs) |
| `playwright test --project=clock --no-deps` (separate invocation, fresh mock: the fixture re-created the sign-in state) | **3/3** pass (2 F02-T10 + F05-T8) |
| `playwright test --project=perf --no-deps` (once, load avg 6.6) | **5/5** pass — see Perf |

All runs with `VITE_PORT=5273 MOCK_PORT=4100`.

**T12 command (D-077).** `--no-deps` skips the setup project *and* the chromium → perf → clock ordering, so run:
```
VITE_PORT=5273 MOCK_PORT=4100 pnpm e2e --project=setup --project=chromium --no-deps
VITE_PORT=5273 MOCK_PORT=4100 pnpm e2e --project=clock --no-deps
```
Each worker checks `e2e/.auth/super-admin.json` against the running mock and signs in again if it is missing or stale, so either command also works on its own. Without `--no-deps`, `pnpm e2e --project=clock` runs setup → chromium → perf → clock.

## Acceptance tests
| ID | Result | Evidence |
|---|---|---|
| F02-T1 SessionStore | pass (8) | `session/session-store.test.ts`: load 200 / 401 (once per start, no notice), login (+ failed login keeps state, clears notice), acceptInvite, logout clears even on failure (and its own 401 is not an expiry), expire only when authenticated, subscribers notified/unsubscribed, a login racing the start-up probe wins |
| F02-T2 safe-redirect | pass (22) | `session/safe-redirect.test.ts`: allows `/live-tracking?vehicle=x`, `?view=table`, `/admin…`; rejects `//evil.com`, `/\evil.com`, `/\t/evil.com`, `https://…`, `http://localhost/…`, `javascript:`, relative, `/login` (+ query, trailing slash), other auth routes, empty, non-strings |
| F02-T3 api-client | pass (5) | `shared/api/api-client.test.ts`: JSON + cookie, GET default, 204, `ApiError {status, code, message, details}`, network/5xx = unreachable, 401 → hook except `POST /api/auth/login`, 403 no hook |
| F02-T4 components | pass (20 + 5 guards + 2 bootstrap) | `components/auth-pages.test.tsx`: login validation + `aria-describedby` + focus, show/hide, disabled + spinner in flight, Enter submits, safe/unsafe redirect, 401 generic / network; forgot: identical confirmation for known, unknown and 4xx, error only on 5xx; reset: checklist per rule, mismatch after blur, success → notice, missing token / 410 → expired, 422 field message; accept: read-only email, focus first invalid, signed in → `/live-tracking`, missing / 410 / 404 → invalid, 409 → already accepted; user menu: initials/name/email, sign out → `/login` (no expiry notice). `app/app.test.tsx`: guard redirect with `?redirect=`, signed-in `/login` & `/forgot-password` → `/live-tracking`, reset works without a session probe, **no shell markup before the probe resolves**, expiry in the shell → `/login?redirect=` + notice. `app/bootstrap-live-tracking.test.ts`: worker starts on sign-in only, stop + cache reset on sign-out, fresh start for another user, WS `unauthenticated` → expiry |
| F02-T5 e2e | pass | `/live-tracking?view=table` signed out → `/login?redirect=%2Flive-tracking%3Fview%3Dtable`; **0 live WS, 0 workers, 0 style/tile requests** on `/login`; sign in → same URL, table rows, `Live`, map frame > 0 |
| F02-T6 e2e | pass | wrong password and unknown email → "Invalid email or password.", still `/login`; `/admin` → `/login?redirect=%2Fadmin` |
| F02-T7 e2e | pass | invited test user → Forgot → confirmation → mailbox link → reset → "Password updated…" notice → old password rejected, new one signs in → same link again → "expired or already used" |
| F02-T8 e2e | pass | `POST /api/invites` → accept page shows the email → name + password → `/live-tracking` signed in (menu shows Operator) → sign out → sign in with the new account |
| F02-T9 e2e | pass | sign out → `/login`, live WS closed / worker gone (D-078); Back → guard → `/login`, no live pill; cookies cleared mid-session → row click (trail fetch 401) → `/login?redirect=%2Flive-tracking…` with "Your session has expired…" |
| F02-T10 e2e (clock) | pass | `auth.clock.spec.ts`: reset link at +31 min → expired state + "Request a new link"; invite link at +7 d +1 min → "expired or no longer valid"; clock reset to 0 after each; pages run signed out so the shared session is never touched while shifted |
| F02-T11 screenshots | done | `screenshots/`: `sign-in.png`, `sign-in-error.png`, `forgot-confirmation.png`, `reset-rules.png`, `reset-expired.png`, `accept-invite.png`, `invite-expired.png`, `user-menu.png` (1280 px); `mobile-sign-in.png`, `mobile-user-menu.png` (390 px) |
| F02-T12 | pass | rows above |

## Budgets (spec §3)
| Budget | Result |
|---|---|
| `/login`: no worker, no WS, no map tiles before sign-in | pass (F02-T5 counts 0 / 0 / 0; the backdrop is CSS only) |
| ≤ 1 `/api/auth/me` per app start | pass (T1: `load()` memoised; reset/accept-invite don't probe) |

## Perf (existing budgets, perf project once after the setup change)
| Spec | Result |
|---|---|
| F04-T9 (now starts signed in; waits for `/me`, not the dev login) | first data 1105 ms (≤ 2000), snapshot 1453 ms (≤ 5000), state 35.5 MB |
| F04-T10 | 3.33 pushes/s, 0 long tasks while streaming (longest during load 130 ms), 18,286 rows/s |
| F06-T9 | 0 long tasks; 28 fps mean, p95 50 ms |
| F08 frame after filter change | running 119, stopped 94, all 113, search 27, clear 61 ms (≤ 200); no long tasks |
| F09-T7 | scroll no long tasks; export 636 ms, no long tasks |

## Bugs found and fixed during F02
- Expiry redirect loop: the layout effect re-ran on its own navigation (`href` dependency) — now reads the location once when the session ends.
- Forgot-password e2e typed into the outgoing login form during the route transition — waits for the new heading.
- Invite expiry showed `21 Oct 26 | 06:24:58` — now `21 Oct 2026, 10:18 IST` (UAT screenshot review).
- Eager auth screens pulled zod into the main chunk (+112 kB) — lazy route chunks.
- F07 e2e helper raced the first snapshot once the dev sign-in delay was gone (2 deterministic failures) — waits for `snapshotCompleteAt` (D-077).

## Open items
- One F09-T9 run (CSV "Exported N rows" toast within 30 s) failed once under the full parallel chromium load and passed alone and in the final full run; not F02-related, noted as possibly flaky.
- The "already accepted" invite state is reachable only on a `409`; the mock answers `410` for accepted tokens (D-075).
