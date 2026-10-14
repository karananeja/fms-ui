# F03b People — Test report

Branch `feature/f03b-people` (worktree `../fms-ui-f03b`, ports 5373/4200). **Ready for integration with F03a / UAT.** Not merged; D-083…D-085 are Proposed.

## Final runs (2026-10-14)
| Command | Result |
|---|---|
| `pnpm check` (tsc -b, eslint ., vitest run) | pass — **585/585** tests, 49 files, 0 lint warnings (+19 from F03b: 13 T4 component, 1 bootstrap, 5 T8 mock) |
| `pnpm build` | pass; main chunk 685.6 kB (686 kB on the contract commit); admin pages stay lazy route chunks |
| `playwright test --project=setup --project=chromium --no-deps` | **44/44** pass (setup + 43, incl. 8 F03b specs) |
| `playwright test --project=clock --no-deps` | **3/3** pass |

All runs with `VITE_PORT=5373 MOCK_PORT=4200`. Perf not run (no budget-relevant change; orchestrator runs it after merge). Other features' UAT screenshots rewritten by the e2e run were restored with `git checkout`.

## Acceptance tests
| ID | Result | Evidence |
|---|---|---|
| F03-T4 component | pass (13 + 1 bootstrap) | `people/people-pages.test.tsx`: Users — role names, fleet scope "North, South +1", status pills, search / status / role filters; own row → role select and Disabled button disabled with "You can't change your own role." / "…status."; Disable → alertdialog "They will be signed out now." → `updateUser(id, {status:'disabled'})` only after confirm; scope change saved without confirm. Invites — Pending by default, All shows the rest, relative + IST times; dialog: empty submit → email / role / fleet errors, no call; 409 → `aria-invalid` email with the server message as its description; Resend on expired (no Revoke), Revoke on pending only after confirm. Roles — `n / 11` and user counts; Super Admin all checkboxes disabled, no Save/Delete; Operator: Invite users / Manage roles disabled with the reason, save sends the ordered set; delete 409 shown in the panel. `components/admin-overview-page.test.tsx`: all four cards with counts for the super admin; with only `users.manage` just the Users card (and no fleets fetch). `app/bootstrap-live-tracking.test.ts`: no worker without `live.view`, caches still reset, next user with it starts the worker |
| F03-T5 e2e | pass | Custom role (`live.view`, `table.view`, `users.manage`) created; super admin invites through the Invites dialog with that role + **North** → F02 accept page → `/live-tracking`, `me.fleetIds = [North]`; main nav = Live tracking, Admin, Users; `/admin/roles`, `/admin/invites`, `/admin/fleets` → No access; `/admin/users` works. Super admin disables them in the Users panel (confirm text checked) → the user's next action lands on `/login` |
| F03-T6 e2e | pass (4) | Each with a fresh invited user: no `vehicle.parameters.view` → details open (debug picker), Overview tab present, Parameters tab absent; no `table.view` → no Table view button, `?view=table` shows the map and no table; no `table.export` → table + Columns visible, no Export CSV; no `live.view` (`users.manage` only) → `/` lands on `/admin`, nav = Admin, Users, `/live-tracking` → No access with "Go to admin", **0 `/ws/live` sockets and 0 workers** |
| F03-T7 e2e | pass | `ops@fms.local`: `/api/fleets` ids = North's subtree computed from the super admin's full tree; North's `vehicleCount` < root's; fleet pulse total = North count; filter panel fleet tree has exactly the subtree's items, North first; table total = North count; CSV data rows = North count (D-085: the filter panel tree stands in for the picker, which no ops page renders) |
| F03-T8 mock unit | pass (5) | `mock-server/tests/roles-system-only.test.ts`: POST with `users.invite` / `roles.manage` → 422 `validation_failed`, issue path `['permissions']` naming the permission; PATCH a custom role with either → 422 and the role unchanged; system role PATCH still 409; an invite past `INVITE_TTL_MS` (dev clock) resends to `pending` |
| F03-T9 screenshots | done | `screenshots/`: `admin-overview.png`, `users.png`, `users-panel.png`, `users-panel-self.png`, `invites.png`, `invites-dialog.png` (409 on email), `roles.png`, `roles-editor.png` (locked Admin permissions), `no-access.png` (1280 px); `users-mobile.png`, `users-mobile-panel.png` (390 px, bottom sheet). Taken on a fresh mock |
| F03-T10 | pass | rows above |

## Notes / open
- The e2e invite steps click the fleet name inside the "Fleet scope" group; if F03a's tree picker renders names differently, update `e2e/access-people.spec.ts` (two places) on `integration/f03`.
- Users with `users.manage` but not `roles.manage` (possible for custom roles) see role ids instead of names and can't change roles (D-084).
