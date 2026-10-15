# F27 — Share Dashboards with Edit or View Access · Intent

**Status:** Signed off: 2026-10-16 (user: "go with recommendations")

**Resolved:**
- Chats are private per person; only the dashboard is shared.
- Q2: editors can use the AI in their own chat.
- Q4: only the owner shares or changes access.
- Q5: changes are pushed live to everyone who has the dashboard open (existing WebSocket).
- Q6: starts after F23 and the snapshot work (D-142).

## Why
The user wants to choose, per person, whether a shared dashboard is **view-only** or **editable**. Today sharing is view-only (D-116, D-121).

## What
- **Access levels per share:** `view` or `edit`. The owner picks one when sharing and can change it at any time in the share dialog. Existing shares stay `view`.
- **Who can do what:**

| Action | Owner | Editor | Viewer |
|---|---|---|---|
| See the dashboard, refresh, duplicate to own | ✓ | ✓ | ✓ |
| Move/resize widgets, add/edit/remove widgets, rename | ✓ | ✓ | — |
| Use their own private dashboard chat (AI builds/edits), add previews | ✓ | ✓ | — |
| Undo the latest change, if they made it (the Undo chip lives in their own chat) | ✓ | ✓ | — |
| Share, change access, revoke | ✓ | — | — |
| Delete the dashboard | ✓ | — | — |

- **Data scope is unchanged:** widget data is always fetched as the person viewing. An editor can only **add** widgets whose data they can read themselves (`widget_not_permitted`, checked against the editor, not the owner).
- **Chats are never shared, only the dashboard** (user, 2026-10-16):
  - Each person who can edit has their **own private chat** on that dashboard. The thread is keyed by (dashboard, user); the owner's existing thread stays the owner's.
  - Others never see someone else's messages. They only see the resulting dashboard changes ("Edited by Priya · 2 min ago").
  - The AI acts as the person chatting, with their scope.
  - Viewers have no chat.
  - Revoking a share or downgrading it to view deletes that person's chat on the dashboard.
- **Working at the same time:**
  - Saves keep the version check (409 → reload with a notice, D-130).
  - Others with the dashboard open get changes pushed live over the existing WebSocket.
  - An "Edited by Priya · 2 min ago" line shows in the title bar.
  - Only one AI turn can run per dashboard at a time; others see "Priya is asking the assistant…" instead of an error.
- **UI:**
  - The share dialog gets a View/Edit selector per person.
  - Cards in "Shared with me" show a "Can edit" or "View only" badge.
  - Editors get the full editing UI, with the owner-only actions hidden.
- **Activity:** each change set records who made it. Others see it as the "Edited by …" line and in a small activity list on the dashboard (no chat content).

## Out of scope
Transferring ownership, public (signed-out) links, comments on widgets, live cursors, and per-widget permissions.

## Done when
- API tests: the access matrix above (edit vs view vs stranger); a level change applies at once; an editor can't share, change access or delete; an editor can't add a widget they can't read.
- e2e: the owner shares with edit → the editor drags a widget and asks the AI for a widget → the owner sees both (live or after a reload); a viewer's UI stays read-only; downgrading an editor to view removes the editing UI.
- Concurrent edits: two editors saving at once → one gets the conflict notice; nothing is lost silently.
