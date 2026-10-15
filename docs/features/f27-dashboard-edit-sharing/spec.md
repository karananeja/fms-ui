# F27 — Share Dashboards with Edit or View Access · Spec

**Status:** Draft (implements the signed-off intent of 2026-10-16). Decisions D-150…D-154 (Proposed).
Builds on F18 (D-116, D-121), F19 (D-124), F20 (D-130, D-135) and D-142.

## 1. Data model (migration v10 `dashboard_edit_sharing`, append-only)
```sql
ALTER TABLE dashboard_shares ADD COLUMN access TEXT NOT NULL DEFAULT 'view' CHECK (access IN ('view','edit'));
ALTER TABLE dashboard_messages ADD COLUMN user_id TEXT;            -- thread owner (dashboard, user)
UPDATE dashboard_messages SET user_id = (SELECT owner_id FROM dashboards d WHERE d.id = dashboard_id);
CREATE INDEX dashboard_messages_user ON dashboard_messages (dashboard_id, user_id, seq);
ALTER TABLE dashboard_changes ADD COLUMN actor_id TEXT;             -- who made the change set
UPDATE dashboard_changes SET actor_id = (SELECT owner_id FROM dashboards d WHERE d.id = dashboard_id);
ALTER TABLE dashboards ADD COLUMN updated_by TEXT;                  -- last content editor
UPDATE dashboards SET updated_by = owner_id;
CREATE TABLE dashboard_activity (id TEXT PRIMARY KEY, dashboard_id TEXT NOT NULL REFERENCES dashboards(id)
  ON DELETE CASCADE, user_id TEXT NOT NULL, summary TEXT NOT NULL, version INTEGER NOT NULL,
  change_id TEXT, at INTEGER NOT NULL);
CREATE INDEX dashboard_activity_dash ON dashboard_activity (dashboard_id, at DESC);
```
- Existing shares become `view`; existing threads become the **owner's** thread (backfill above).
- `seq` stays unique per dashboard (no table rebuild); a user's thread is `WHERE user_id = ?`, pruned to 200 **per user**.
- Activity: ≤ 20 rows per dashboard. A manual save by the same user within 2 min of their previous manual row updates that row; each AI change set is one row (extended with it). Dev reset wipes `dashboard_activity`.

## 2. Contract (`shared/contract/dashboards.ts`, share/summary/thread sections; `ws.ts`)
- `dashboardAccessSchema` = `owner | editor | viewer` (Dashboard + DashboardSummary).
- `SHARE_ACCESS = ['view','edit']`; `DashboardShare` gains `access`. `addSharesBody` gains optional `access` (default `view`; re-adding an existing share leaves its level alone).
- `PATCH /api/dashboards/:id/shares/:userId` body `{ access }` → the share list.
- `Dashboard.lastEdit?: { userId, name, at } | null` (from `updated_by` / `updated_at`).
- `GET /api/dashboards/:id/activity` → `{ items: { id, userId, name, summary, version, at }[] }` (newest first, ≤ 20; no chat text).
- `chat_busy` 409: message `"<name> is asking the assistant…"`, `details.by = { userId, name }`.
- WS: topic `dashboard`, scope `{ kind: 'dashboard', dashboardId }`; server message `{ type: 'dashboard', id, event }`:

| `event.kind` | Fields | Sent to |
|---|---|---|
| `changed` | `dashboardId, version, by {userId,name}, at, summary` | every subscriber who still has access |
| `assistant` | `dashboardId, running, by {userId,name} \| null` | every subscriber (also once right after subscribe while a turn runs) |
| `access` | `dashboardId, access: editor \| viewer \| null` | only the affected user; `null` ends that subscription |
| `deleted` | `dashboardId` | every subscriber; subscriptions end |

Subscribe needs an active user with `dashboards.use` and access to the dashboard (else `error` `not_found`; the socket stays open). Share-link sockets: 4403. The flush loop skips `dashboard` subs.

## 3. Endpoint permission matrix (O owner · E editor · V viewer · S stranger)
| Endpoint | O | E | V | S |
|---|---|---|---|---|
| `GET /dashboards`, `GET /:id`, `POST /:id/duplicate`, snapshot GET/PUT, `GET /:id/activity` | ✓ | ✓ | ✓ | 404 |
| `PATCH /:id` (widgets, layout, title, description) | ✓ | ✓ | 403 | 404 |
| `DELETE /:id` | ✓ | 403 | 403 | 404 |
| `GET/POST /:id/shares`, `PATCH/DELETE /:id/shares/:userId` | ✓ | 403 | 403 | 404 |
| `GET /:id/thread` (caller's own thread), `POST /api/dashboards/:id/chat`, `PATCH /:id/previews/:pid` (own thread) | ✓ | ✓ | 403 | 404 |
| `POST /:id/changes/:cid/undo` | own change | own change | 403 | 404 |

- Undo: the change must be the dashboard's latest, not undone, nothing written after it (D-121) **and** `actor_id = caller`; else 409 `not_undoable`. `ChangeSet.undoable` is computed for the caller.
- `widget_not_permitted` is checked against the **acting** user's permissions (PATCH and AI writes): an editor can't add a widget they can't read.
- Level changes apply at once (every request reads `dashboard_shares`). Downgrade to `view` or revoke deletes that user's messages on the dashboard (and their snapshot on revoke, D-142).

## 4. AI chat (F19)
- The thread, transcript, cache key (`chatCacheKey(user, d:<id>)`) and `appendMessage` are per (dashboard, user); the AI runs as the chatting user (`host.user`, their permissions and fleet scope).
- Lock (D-124) stores the holder `{userId, name}`; take/release publish `assistant` events. A second turn (anyone) or an undo/preview-state call during a turn → 409 `chat_busy` with the holder's name.
- **`mock-server/assistant/dashboard-tools.ts` (applied after F26 finished; 1–4 all follow from the `owned()` change):**
  1. `owned(host, id)`: accept `access === 'editor'` when `host.mode` is the dashboard chat of `id` (global chat stays owner-only).
  2. `get_dashboard` without a ref in a dashboard chat: resolve the current dashboard even when it is not in `list().mine` (works once 1 is done).
  3. `previewWidget`: same `owned` rule for the dashboard-chat case (follows from 1).
  4. Doc comment ("Owner-only…") → "owner or editor in the dashboard's own chat".
  `mutate()` → `applyTurn(host.user.id, …)` already passes the acting user, so actor, activity and `widget_not_permitted` need no further change.

## 5. Concurrency
- Saves keep the version check: two editors PATCHing the same version → one 200, one 409; the client soft-reloads with the D-130 notice. Nothing is merged or lost silently.
- A `changed` push makes other open pages GET the dashboard and `adoptRemote` it (version-gated); their queued edits rebase on it as today; a debounced layout still in flight may 409 → notice.
- One AI turn per dashboard: others see "Priya is asking the assistant…" in their dock (composer disabled) instead of an error; if they send anyway, the 409 becomes that notice (no error bubble).

## 6. Client
- `src/features/dashboards/store/dashboard-socket.ts`: a main-thread `DashboardSocket` (F04 `WsClient`, same pattern as `events-socket.ts`); one socket while a dashboard page is open; re-subscribes on reconnect and asks the page to re-sync. No worker involvement (D-005).
- Page: `canEdit = access !== 'viewer'`; owner-only = Share / Delete. Grid editing, inline rename, chat dock and previews for owner + editor. On `changed` (other user) → GET + adopt, refresh activity; on `access` → reload (toast "Your access changed: view only" / not-found view); on `deleted` → not-found view.
- Title bar: badge "Can edit · shared by X" / "View only · shared by X"; status line "Edited by Priya · 2 min ago" when the last edit is someone else's (else the existing Saved/Updated text); an **Activity** button opens a small list (who · summary · when).
- Share dialog: "Can view / Can edit" selector for new people; a View/Edit select per person (owner only); copy explains both levels.
- Cards in "Shared with me": access badge "Can edit" / "View only"; Rename in the card menu for editors.
- Chat store: `chat_busy` on send → drop the optimistic pair, show the holder notice.

## 7. Acceptance tests
| ID | Test | Where |
|---|---|---|
| F27-T1 | Migration v10: old shares read `view`, old thread rows belong to the owner, old change sets' actor = owner | `mock-server/tests/f27-edit-sharing.test.ts` |
| F27-T2 | Access matrix owner/editor/viewer/stranger over every endpoint in §3 | same |
| F27-T3 | Level change applies at once (view→edit→view); downgrade/revoke deletes that user's thread | same |
| F27-T4 | Editor can't share, change access, revoke or delete; can't add a widget they can't read (`widget_not_permitted`) | same |
| F27-T5 | Two editors save the same version → one 409, the other's change kept; activity + `lastEdit` record who | same |
| F27-T6 | Per-user threads: editor's chat thread separate from the owner's; undo only own latest change; `chat_busy` names the holder | same |
| F27-T7 | WS: subscribe rules, `changed` after a PATCH, `access` on downgrade/revoke, `deleted`, `assistant` running/idle | same |
| F27-T8 | e2e: owner shares with edit → editor drags a widget and asks the AI for a widget → owner sees both (live) | `e2e/f27-edit-sharing.spec.ts` |
| F27-T9 | e2e: a viewer's UI stays read-only; downgrading the editor to view removes the editing UI live | same |
| F27-T10 | e2e: share dialog View/Edit select; "Can edit" / "View only" badges in Shared with me | same |

## 8. Decisions to propose
| ID | Decision |
|---|---|
| D-150 | Per-share access `view \| edit` on `dashboard_shares` (default `view`, migration v10); `access` = `owner \| editor \| viewer`; only the owner shares, changes access (`PATCH …/shares/:userId`), revokes or deletes. Amends D-116/D-121 (view-only sharing, owner-only writes). |
| D-151 | Chats are private: threads keyed by (dashboard, user) via `dashboard_messages.user_id` (backfilled to the owner), pruned per user; downgrade/revoke deletes that user's thread. Change sets record `actor_id`; Undo only by its actor, still latest-only (D-121). |
| D-152 | Activity: `dashboards.updated_by` + `dashboard_activity` (≤ 20, no chat text) → `lastEdit` on the dashboard and `GET …/activity`; manual saves coalesce per user within 2 min. |
| D-153 | Live push over the existing `/ws/live` socket: new topic `dashboard` (scope `{kind:'dashboard'}`) with `changed / assistant / access / deleted` events; main-thread `DashboardSocket` (not the fleet worker); clients re-GET on `changed`. |
| D-154 | One AI turn per dashboard stays (D-124); the lock records its holder; `chat_busy` carries `details.by` and the UI shows "<name> is asking the assistant…" instead of an error. |
