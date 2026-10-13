# F03 — Access Control (fleet tree, users, invites, permissions) · Intent

**Status:** Signed off: 2026-10-13 (user)

## Why
Access must be granted per fleet (B7) with granular permissions (B8). That way a customer sees only their own fleet, and only the actions they are allowed.

## What
- **Fleet tree:**
  - Nested fleets up to **5 levels**.
  - Each vehicle belongs to **exactly one** fleet.
  - Access to a fleet node includes its whole subtree.
- **Permission catalogue** (proposed):
  - `live.view`
  - `vehicle.details.view`
  - `vehicle.parameters.view`
  - `table.view`
  - `table.export`
  - `share.create`
  - `share.revoke`
  - `users.invite`
  - `users.manage`
  - `fleets.manage`
  - `roles.manage`
- **Roles** are named permission sets. **Super admin** has every permission and is the only role allowed to invite users (B8).
- **Admin screens** (super admin only):
  - Fleet tree management: create, rename, move, and move vehicles between fleets.
  - Users list.
  - Invite user: email, role, fleet nodes.
  - Pending invites: resend, revoke.
  - Role editor.
- **The UI respects permissions everywhere.** Controls are hidden or disabled when the user lacks the permission. The server is still the authority.

## Out of scope
- Audit log UI.
- Bulk CSV user import.

## Done when
- A user scoped to a sub-fleet sees only that subtree's vehicles on the map, table and CSV.
- Each permission demonstrably gates its control.

## Resolved
- Admin screens **are in scope** for this phase (D-016).
- The permission list is accepted.
