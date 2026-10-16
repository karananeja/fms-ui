# F29 — Assistant actions, with confirmation, audit log and Undo · Spec

**Status:** Draft, 2026-10-16. Building on the user's go-ahead ("speed up, focus on development"); sign-off at UAT. Intent signed off 2026-10-16.
**Depends on:** F28 (action cards are stored in saved threads), F03 (`can()`), F22 stores.
**Proposed decisions:** D-166 (propose / confirm flow), D-167 (audit log and Activity page, `audit.view`), D-168 (Undo rules).

## 1. Flow

1. **Propose.** A write tool never changes data. It validates the input, checks the caller's permission with `can()` and reads the current state of the target. Then it stores a **proposal**: `assistant_actions` row, status `proposed`, expires in 10 minutes. It emits `action_proposed` with the card, and tells the model: "Proposed <summary> (action <id>). Nothing has changed yet; the user must confirm it. Do not say it is done."
2. **Card.** The chat shows a card with:
   - what will change, for whom, and before → after (up to 5 rows, then "+N more" for a batch)
   - whether it can be undone
   - **Confirm** and **Cancel**
3. **Confirm.** `POST /api/actions/:id/confirm`. The server:
   - checks the proposal: the caller's own, still `proposed`, not expired
   - checks the permission again
   - re-reads the target and compares it with the snapshot taken at proposal time; if it changed: 409 `action_stale`, "This changed since it was proposed. Ask again to review it."
   - runs the same store function the REST route uses, inside `atomic()`
   - writes an audit row and marks the proposal `done` (or `failed` with the error message)
   - appends a short result line to the thread, so the model sees the outcome on its next turn
4. **Cancel.** `POST /api/actions/:id/cancel` marks it `cancelled`. An expired proposal shows "Expired. Ask again."
5. **Rules:** the model cannot confirm anything, because no tool confirms. A batch holds at most 50 items and is one proposal: all or nothing.

## 2. Actions

Every action uses the same store function, scope rule and permission as its REST endpoint.

| Area | Kind | Permission | Undo |
|---|---|---|---|
| Drivers | `driver.create`, `driver.update` (name, phone, fleet, status) | drivers.manage | update: yes (previous fields); create: no |
| | `driver.assign`, `driver.unassign` | drivers.manage | yes (previous assignment) |
| Requests | `request.approve`, `request.reject` | requests.manage | no |
| Users | `invite.create`, `invite.resend`, `invite.revoke` | users.invite | create: yes (revoke); others: no |
| | `user.update` (name, role, fleets, enabled) | users.manage | yes (previous values) |
| Roles | `role.create`, `role.update`, `role.delete` | roles.manage | update: yes; others: no |
| Fleets | `fleet.create`, `fleet.rename`, `fleet.delete`, `fleet.settings` | fleets.manage | rename and settings: yes; others: no |
| | `vehicles.move` (≤ 50 vehicles) | fleets.manage | yes (back to each vehicle's previous fleet) |
| Sharing | `share_link.create`, `share_link.revoke` | share.create / creator or share.revoke | create: yes (revoke); revoke: no |
| Notifications | `notifications.read` | signed in | no |

Out of scope, as in the intent: driver self-service, AI keys and settings, deleting users.

## 3. Storage (migration v16)

```sql
CREATE TABLE assistant_actions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, thread_id TEXT, dashboard_id TEXT,
  kind TEXT NOT NULL, params_json TEXT NOT NULL, preview_json TEXT NOT NULL,
  state_hash TEXT NOT NULL,            -- target state at proposal time
  status TEXT NOT NULL CHECK (status IN ('proposed','done','failed','cancelled','expired','undone')),
  result_json TEXT, undo_json TEXT,    -- what Undo needs (previous values)
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, decided_at INTEGER, undone_at INTEGER
);
ALTER TABLE audit_log ADD COLUMN area TEXT;
ALTER TABLE audit_log ADD COLUMN action_id TEXT;
ALTER TABLE audit_log ADD COLUMN thread_id TEXT;
ALTER TABLE audit_log ADD COLUMN before_json TEXT;
ALTER TABLE audit_log ADD COLUMN after_json TEXT;
ALTER TABLE audit_log ADD COLUMN undone_at INTEGER;
```

## 4. API

| Route | Who | Notes |
|---|---|---|
| `POST /api/actions/:id/confirm` | the proposer | 404 for anyone else; 409 `action_stale`, `action_expired`, `action_closed`; 403 when the permission is gone |
| `POST /api/actions/:id/cancel` | the proposer | |
| `POST /api/actions/:id/undo` | the proposer, or `audit.view` + the action's own permission | 24 h after it was done, and only while the target is unchanged since; else 409 `not_undoable`. Audited as `<kind>.undo` |
| `GET /api/audit?user=&area=&kind=&from=&to=&q=&before=` | `audit.view` | newest first, 50 per page; each entry has `undoable`, `undone`, `threadId` (only for the viewer's own entries), `target` link |
| `GET /api/audit.csv?…` | `audit.view` | same filters |

SSE: `{ type: 'action_proposed', action: ActionCard }`. Thread extras store the card, and its status is refreshed on reload.

## 5. Permission (contract change)

New permission **`audit.view`** ("View activity log"), given to the Super Admin and Admin system roles by the seed and by a migration for existing databases. It is not given to operators.

## 6. UI

- **Action card** (both chats): area icon, summary, before → after rows, a "Can be undone" or "Can't be undone" note, then **Confirm** and **Cancel**. After a decision it shows Done (with **Undo** while possible), Cancelled, Expired or Failed (with the reason).
- **Activity page** `/admin/activity` (`audit.view`), in the admin nav:
  - filters: user, area, action, date range, search; Export CSV
  - each row: time (IST), who, what (summary), area chip, status (done or undone)
  - row actions: **What changed** (expands before → after), **Undo** (inline confirm), **Open chat** (own entries only) and **Open target** (driver, user, fleet, request or share link page)

## 7. Acceptance tests (relaxed for speed)

| ID | What it proves |
|---|---|
| F29-T1 | Each kind proposes without changing data; confirm applies it via the store; the permission is re-checked; stale and expired proposals are refused (one table-driven server test) |
| F29-T2 | Undo for the reversible kinds; refused after the target changed or after 24 h; Undo is audited |
| F29-T3 | Audit list filters and `audit.view` gating; CSV header |
| F29-T4 | e2e (fake model): "assign driver X to vehicle Y" → card → Confirm → done → Undo; Cancel; Activity page shows the entry |
