# F25 — User-provided AI Keys (Bring your own key) · Intent

**Status:** Signed off: 2026-10-15 (user: Q2 "recommendation": per-user keys; the server `.env` key is a fallback that an admin setting can switch off). Starts after F22.

## Why
Users should be able to use the assistant with their own AI provider keys, without editing the server's `.env`.

## What
- **Settings → AI assistant:**
  - Pick a provider (xAI Grok, OpenAI, Anthropic), paste a key and choose a model from a list fetched with that key.
  - **Test connection**, plus Save and Remove.
  - The key is shown masked (`xai-…9f3c`) and is never sent back to the browser.
- **Storage:**
  - Encrypted at rest in SQLite (AES-256-GCM with a server secret `FMS_SECRET_KEY` from `.env`; refuse to store keys if it is missing).
  - Linked to the user.
  - Depends on F22 (accounts in the DB).
- **Use:**
  - The user's own key takes precedence. Otherwise the server key from `.env` (F21) is used, if the admin setting "Allow the server key as a fallback" is on. Otherwise "not configured", with a link to Settings.
  - The chat header shows which provider/model is answering.
- **Security:**
  - Keys are used only server-side and never logged (redacted in errors).
  - Rate limits on Test connection.
  - Removing a user deletes their keys.
  - Audit entries for key added/removed (no key material).

## Out of scope
Usage billing and quotas, provider fine-tuning, a key vault or KMS.

## Done when
- A key is saved encrypted (the DB row is not plaintext) and is never in any API response.
- Chat uses the user key (fake providers accept a test key).
- Removing the key falls back or shows "not configured".
- e2e covers Settings: add, test, remove.
