# F02 — Authentication · Spec

| Field | Value |
|---|---|
| Status | **Draft: awaiting user sign-off** |
| Intent | `intent.md` (signed off 2026-10-13) |
| Visual source of truth | DS1 tokens + Doto (D-054). The auth screens are new surfaces, so §4 proposes their look. |
| Server contract | Already built in F01: `/api/auth/*`, `shared/contract/auth.ts`, `password-policy.ts` (D-018). F02 adds **no** server changes. |
| Branch / delivery | `feature/f02-authentication`. Decision IDs reserved: D-075…D-078 |

## 1. Files (kebab-case)
```
src/shared/api/
  api-client.ts                 fetch wrapper: credentials 'include', JSON, typed ApiError {status, code, message}, 401 hook
src/features/auth/
  session/session-store.ts      class SessionStore: status 'unknown' | 'authenticated' | 'anonymous', me, load/login/logout/expire; subscribe/getSnapshot
  session/use-session.ts        useSyncExternalStore selectors
  session/safe-redirect.ts      validates ?redirect= (same-origin relative paths only)
  components/auth-layout.tsx    shared backdrop + glass card for all auth screens
  components/password-field.tsx show/hide toggle
  components/password-rules.tsx live checklist from passwordSchema
  components/login-page.tsx
  components/forgot-password-page.tsx
  components/reset-password-page.tsx
  components/accept-invite-page.tsx
  components/user-menu.tsx      avatar in the rail: name, email, role, Sign out
src/app/
  router.tsx                    guards (replaces auth placeholders)
  bootstrap-live-tracking.ts    starts/stops live tracking from the session, no dev auto-sign-in
  dev-session.ts                deleted
e2e/
  auth.setup.ts                 signs in once; saves storageState for the other specs
  auth.spec.ts, auth.clock.spec.ts
```
No new dependencies. Forms use react-hook-form + zod (already in the stack), and the schemas are the shared ones from `shared/contract`.

## 2. Requirements

### Session
| ID | Requirement |
|---|---|
| F02-R1 | **`SessionStore`** is the only owner of "who is signed in".<br>• `load()` calls `GET /api/auth/me` once per app start: 200 → `authenticated` with `me`; 401 → `anonymous`.<br>• `login()`, `acceptInvite()` and `logout()` update it.<br>• `expire()` is called on any 401 (R3): it clears `me` and moves to `anonymous`. |
| F02-R2 | **Route guards** (TanStack Router `beforeLoad`):<br>• App-shell routes wait for `load()`; when `anonymous` they redirect to `/login?redirect=<current path + search>`.<br>• `/login`, `/forgot-password` redirect to `/live-tracking` when already `authenticated`.<br>• `/reset-password`, `/accept-invite` and `/share/$token` work in either state.<br>• No app-shell markup is rendered before the guard resolves (a blank `--bg` screen, no flash). |
| F02-R3 | **401 anywhere → `/login`:**<br>• `api-client` calls `session.expire()` on a 401 from any endpoint except `POST /api/auth/login` (a wrong password is not an expiry).<br>• The worker's WS close with `unauthenticated` does the same, through the live-tracking store.<br>• The user lands on `/login?redirect=…` with the notice "Your session has expired. Please sign in again." |
| F02-R4 | **Live tracking follows the session:**<br>• The worker starts only when the session becomes `authenticated`.<br>• On logout or expiry, `liveTrackingStore.stop()` closes the WS and terminates the worker, and the REST query cache is cleared.<br>• Signing in as a different user starts a fresh worker with that user's `me`. |
| F02-R5 | **Safe redirect:** `?redirect=` is honoured only if it starts with a single `/` (not `//`, not a scheme) and is not an auth route. Otherwise the target is `/live-tracking`. |
| F02-R6 | **Dev auto-sign-in is removed** (`dev-session.ts`), because the login page now exists. The dev account is still prefilled in the login form in dev builds only (`VITE_DEV_LOGIN_EMAIL`). |

### Screens
| ID | Requirement |
|---|---|
| F02-R7 | **Sign in** (`/login`):<br>• Email + password (show/hide), autocomplete `username` / `current-password`.<br>• Client validation: email format, password required.<br>• The submit button is disabled with a spinner while the request is in flight; Enter submits.<br>• 401 → "Invalid email or password." (generic, never which field). Network/5xx → "Couldn't reach the server. Try again."<br>• Success → the safe redirect target (R5).<br>• "Forgot password?" link. Shows the expiry notice (R3) or the "password updated" notice (R9) when present. |
| F02-R8 | **Forgot password** (`/forgot-password`):<br>• Email field; on submit (any 2xx **or** 4xx) always shows the same confirmation: "If an account exists for <email>, we've sent a link to reset the password. The link is valid for 30 minutes."<br>• Only network/5xx errors show an error. "Back to sign in" link. |
| F02-R9 | **Reset password** (`/reset-password?token=`):<br>• New password + confirm, with the live rules checklist (R12).<br>• Success → `/login` with the notice "Password updated. Sign in with your new password."<br>• **Missing token** or **410** (expired or used) → an error state: "This reset link has expired or was already used." with a "Request a new link" button to `/forgot-password`. 400 shows the server's field messages. |
| F02-R10 | **Accept invite** (`/accept-invite?token=`):<br>• On load, `GET /api/auth/invites/:token` shows the invited email (read-only) and expiry.<br>• Name + password + confirm, with the rules checklist.<br>• Success: the server signs the user in → `/live-tracking`.<br>• **410 / 404 / missing token** → "This invite has expired or is no longer valid. Ask your administrator for a new invite." **409** (already accepted) → "This invite was already accepted." with a "Sign in" link.<br>• No other sign-up route exists. |
| F02-R11 | **Sign out:** the user menu at the bottom of the rail (desktop) and in the mobile drawer shows initials, name, email and role, plus "Sign out". Sign out calls `POST /api/auth/logout`, then always clears locally (even if the request fails), and goes to `/login`. |
| F02-R12 | **Password rules** checklist under the new-password field: "8+ characters", "A letter", "A number". Each turns to a check as it is met. It reads its rules from the shared `passwordSchema` (single source, D-018). Confirm shows "Passwords don't match" after blur. |
| F02-R13 | **Accessibility:** labelled fields, errors linked with `aria-describedby`, `role="alert"` for form errors, focus moves to the first invalid field on submit, and every screen works with the keyboard only. |

## 3. Budgets
- `/login` has no live-tracking work: no worker, no WS and no map tiles are requested before sign-in.
- Guard resolution adds no more than one `/api/auth/me` round trip per app start.

## 4. Look (proposal)
- **Backdrop:** `--map-bg` with the mockup's faint street-grid pattern (pure CSS) and the vignette. No MapLibre, so no tiles load before sign-in.
- **Card:** a centred glass card, 400 px wide (on mobile, full width with a 16 px gutter). It holds the "F" brand mark, an uppercase muted screen title (e.g. "SIGN IN"), the fields, and one full-width accent button.
- **Type:** Doto throughout. Inputs use `--surface-solid`, with an accent focus ring and errors in `--danger`.
- **States:** error and expired-link states reuse the card with an icon, one sentence and one action.
- UAT screenshots of every screen and state replace a separate mockup. Any visual change you ask for is made during UAT.

## 5. Tests
Existing e2e specs keep working through a Playwright **setup project** (`auth.setup.ts`). It signs in as the seeded super admin and saves `storageState`; the chromium, perf and clock projects depend on it. F02 specs that sign out use their own fresh context, so they never end the shared session.

| ID | Type | Test |
|---|---|---|
| F02-T1 | unit | `SessionStore`: load (200 / 401), login, logout clears even on failure, expire, and subscribers are notified. |
| F02-T2 | unit | `safe-redirect`: allows `/live-tracking?vehicle=x`; rejects `//evil.com`, `https://…`, `javascript:`, `/login`, and empty. |
| F02-T3 | unit | `api-client`: JSON + `ApiError` parsing; a 401 calls `expire()` except from login. |
| F02-T4 | component | Login: validation, button disabled in flight, generic error, redirect. Forgot: identical message for known and unknown emails. Reset and accept: rules checklist, mismatch, expired/used states. User menu sign out. |
| F02-T5 | e2e | Sign in → lands on the originally requested page (`/live-tracking?view=table`), and the map loads. |
| F02-T6 | e2e | Bad password → generic error, still on `/login`. A signed-out visit to `/admin` → `/login?redirect=%2Fadmin`. |
| F02-T7 | e2e | Forgot → mail from `/api/dev/mailbox` → reset → sign in with the new password. Reusing the same link → "expired or already used". |
| F02-T8 | e2e | Super admin creates an invite (`POST /api/invites`) → accept page shows the email → set name and password → lands signed in on `/live-tracking` → sign out → sign in again with the new account. |
| F02-T9 | e2e | Sign out closes the WS (dev probe connection = `unauthenticated` or the worker is gone), and the back button doesn't show live data. Deleting the session cookie mid-session → the next API call or WS reconnect lands on `/login` with the expiry notice. |
| F02-T10 | e2e (clock) | `auth.clock.spec.ts`: the invite link after +7 days and the reset link after +31 minutes (via `/api/dev/clock`) show the expired states. |
| F02-T11 | e2e | UAT screenshots in `docs/features/f02-authentication/screenshots/`: sign in (empty, error), forgot (confirmation), reset (rules), expired link, accept invite, user menu, and mobile sign in. |
| F02-T12 | cmd | `pnpm check`, `pnpm build` (leak scan, and `dev-session` gone), and e2e `--project=chromium --project=clock --no-deps`, plus the setup project. |

## 6. Out of scope
SSO, MFA, "remember me" (intent), account lockout or rate limiting (server-side; the mock has none), changing the password while signed in, and editing your profile.
