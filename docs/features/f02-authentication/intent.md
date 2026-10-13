# F02 — Authentication · Intent

**Status:** Signed off: 2026-10-13 (user)

## Why
The platform is invite-only and cookie-session based (B9). Users need a secure way in and a way to recover access.

## What
- **Sign in:** email + password. Generic error on bad credentials. Disable the button while the request is in flight. Redirect to the originally requested page.
- **Forgot password:** enter an email, then always show the same confirmation message, so the screen doesn't reveal which accounts exist.
- **Reset password:** reached from a token link. New password + confirm, password rules shown inline, and clear expired/used-token states.
- **Accept invite (sign up):** reached from an invite link. Set name + password. The account is pre-bound to the fleets and permissions chosen by the inviter.
- **Sign out.**
- **Session handling:**
  - Route guards.
  - A `401` anywhere sends the user to `/login`.
  - The WS is closed on logout.
- No public sign-up page exists.

## Out of scope
SSO, MFA and "remember me". These can be added later.

## Done when
- e2e tests pass for: sign in → live tracking, bad password, forgot → reset → sign in, invite → accept → sign in, and an expired token.

## Resolved
- Password policy: **at least 8 characters, with at least 1 letter and 1 number** (D-018).
