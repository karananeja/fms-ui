# F29 — Assistant actions, with confirmation, audit log and Undo · Intent

**Status:** Signed off: 2026-10-16 (user: "yes"). User: "lets expand the scope so that it can perform user level actions if the user has permissions" (chose: confirm every write; all four areas below; audit log + Undo).

## Why
The assistant can find, explain and report, and it can build dashboards. But for anything else the user still has to leave the chat and click through the admin screens. The assistant should be able to do those tasks for the user, safely and only within that user's permissions.

## What
- **New write tools**, one per existing UI action. Each one uses the same store function and the same permission check (`can()`) as the REST endpoint, so the assistant can never do more than the user could do by hand:

  | Area | Actions |
  |---|---|
  | Drivers & requests | create or edit a driver, assign or unassign a driver, approve or reject a request |
  | Users, invites & roles | invite, resend or revoke an invite; edit a user (name, role, fleets, enable or disable); create, edit or delete a role |
  | Fleets & vehicles | create, rename or delete a fleet; move vehicles between fleets; fleet settings |
  | Sharing & notifications | create or revoke a live-location share link; mark notifications read |

- **Confirm every write:**
  - A write tool never runs by itself. It returns a **proposed action** card in the chat: what will change, for whom, before → after, and whether it can be undone.
  - **Confirm** runs it. **Cancel** discards it.
  - **Server checks on Confirm:**
    - The proposal is single-use, belongs to the user who asked, and expires after 10 minutes.
    - Permissions and the current state are checked again when the user confirms. If the data changed since the proposal, the action is refused and the user is asked to review it again.
    - The model cannot confirm its own proposal.
  - **After Confirm:** the result (done, refused or failed) is written into the thread, so the assistant knows the outcome on its next turn.
  - **Batches:** one card may cover a batch (for example, move 12 vehicles), up to 50 items.
  - **Reads:** stay automatic, as today.
- **Audit log:**
  - Every action confirmed through the assistant is recorded: who, when, which action and target, before → after, and a link to the chat thread (F28).
  - The existing `audit_log` table, which today holds AI-key entries only, is extended.
  - An **Activity** page for admins. It is a working screen, not only a list (user: "the activity window is read-only, i want it to be usable"):
    - Filters by user, action, area and date; search; CSV export.
    - **Per entry:**
      - **Undo** (same rules as below; confirmed and audited).
      - **Open chat**: the thread and turn that made the change. Only for the entry's own user, because chats stay private (F28); others see the request text quoted in the entry.
      - **Open target**: the driver, user, fleet, request or share link.
      - **What changed**: before → after.
    - Entries that were undone, or whose target changed since, are marked as such.
  - Seeing it needs a new permission, **View activity log** (`audit.view`), given to the admin system roles. Undo from the page also needs the action's own permission. Adding a permission is a contract change that needs a decision.
- **Undo:**
  - Where the action can be reversed, the done card offers **Undo** for 24 hours, if the target has not changed since. Undo is confirmed and audited like any other action.
  - Reversible actions: assign/unassign, fleet rename, vehicle moves, user edits including enable or disable, role edits, creating a share link (undo = revoke), sending an invite (undo = revoke).
  - Not reversible, so the card says "can't be undone" before Confirm: approve or reject a request, delete a role or fleet, revoke a share link or invite, mark notifications read.

## Out of scope
- Driver self-service actions (`driver.self`).
- Changing AI keys or AI settings through the chat.
- Deleting users.
- Batches above 50 items.
- Undo for actions done in the normal UI, which are not audited. Auditing every REST action could be a later feature.
- Scheduled or recurring actions.

## Depends on
F28: action cards and their audit links live in saved threads. This works in both the global Ask FMS chat and the dashboard chats.

## Done when
- Each listed action can be asked for in plain words. It shows a correct before → after card, runs only after Confirm, and is refused for a user without the permission (unit tests per tool, API tests for refusals, stale state and expiry).
- Every confirmed action appears in the Activity log with the thread link. The log is hidden without `audit.view`.
- Undo works for the reversible actions and is refused once the target has changed.
- e2e (fake model) covers propose → confirm → done → undo, cancel, a permission refusal and the Activity page.
