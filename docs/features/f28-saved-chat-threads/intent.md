# F28 — Saved Ask FMS conversations · Intent

**Status:** Draft, 2026-10-16. Waiting for sign-off. User: "keep track of those chats as well" (chose saved threads, an action audit log and Undo; the last two are in F29).

## Why
Today the global Ask FMS chat lives only in the browser's memory. A reload, a sign-out or another device loses it, and there is no way to go back to an earlier conversation. Once the assistant can act (F29), its chats are also the record of why something was changed.

## What
- **Server-side threads per user** in SQLite. A user sees only their own threads; admins get no read access to other users' chats (the audit log in F29 is the shared record).
- **History in the Ask FMS panel:**
  - **New chat**, and a list of past conversations (newest first, with search by title).
  - **Rename** and **Delete** (with confirm).
  - Titles are generated automatically from the first prompt, reusing the dashboard auto-title (F19).
- **Reopen and continue:** a reopened thread keeps going where it stopped. The server builds the model transcript from the stored thread, the same way the dashboard chat does, so the prompt cache stays warm (F24). The client no longer sends the whole transcript.
- **Turn outcomes stay:** done, error, interrupted and stopped are stored with Retry, as in D-155. Report cards, dashboard links and (from F29) action cards are stored with their state.
- **Limits:** 200 threads per user. The oldest are pruned beyond that. Messages count towards the same transcript cap as today (30 turns sent to the model).

## Out of scope
Sharing or exporting threads, folders, pinning, retention policies other than the 200-thread cap, and moving dashboard chats into this list (they stay on their dashboards).

## Done when
- Ask FMS conversations survive a reload, sign-out/in and a second browser.
- New chat, history list, search, rename and delete work.
- A reopened thread continues with full context.
- A failed turn keeps Retry after a reload.
- One user can never read another user's threads (API test).
- e2e covers new, reopen, continue, rename and delete.
