# 03 — Dev & Test Accounts (mock server only)

These accounts exist only in the **local mock server** (`mock-server/`). Their data lives in memory and resets every time the mock restarts. They are not real credentials and must never be reused for a real backend.

## Seeded accounts (always present)
Defined in `mock-server/store/accounts.ts`; recreated on every mock start.

| Email | Password | Name | Role | Fleet scope | Notes |
|---|---|---|---|---|---|
| `superadmin@fms.local` | `Admin@123` | Super Admin | Super Admin (system, every permission) | Root (Acme Mobility, all 1 lakh vehicles) | Default on the sign-in page in dev (`VITE_DEV_LOGIN_EMAIL`); e2e storageState user (D-077) |
| `ops@fms.local` | `Ops@1234` | Ops User | Operator | North | Used by the F03-T7 scope e2e and the WS proxy e2e |
| `viewer@fms.local` | `View@1234` | Viewer User | Viewer | Delhi Hub 1 | — |

**Seeded roles:**

| Role | Permissions |
|---|---|
| Super Admin (system, read-only) | all |
| Operator | `live.view`, `vehicle.details.view`, `vehicle.parameters.view`, `table.view`, `table.export`, `share.create`, `share.revoke` |
| Viewer | `live.view`, `vehicle.details.view` |

## Accounts created by e2e tests (temporary)
The e2e specs create their own users through invites, so seeded passwords are never changed (D-077). These users disappear when the mock restarts. Their emails are random per run, so look up current ones on **Admin → Users** (signed in as the super admin).

| Spec | Email pattern | Password | Role / scope |
|---|---|---|---|
| `e2e/auth.spec.ts`, `auth.clock.spec.ts` (F02) | `f02-<tag>-<timestamp>-<random>@fms.local` | `OldPass123`, changed to `NewPass456` by the reset tests; invite-accept test: `Invited123` | as invited by the test |
| `e2e/access-people.spec.ts` (F03) | `f03-<tag>-<random>@fms.local` | `People123` | custom roles created by the test (e.g. without `table.view`), North or other sub-fleets; some are **disabled** by the test |

## Creating your own user
1. Sign in as `superadmin@fms.local` / `Admin@123`.
2. Go to **Admin → Invites → Invite user**, then pick a role and fleets.
3. The mock "sends" the invite email by logging `[mail] to <email>: … → /accept-invite?token=…` in the `pnpm dev` console. It also appears at `GET /api/dev/mailbox?to=<email>`. Open that link and set a name and password; the password rules are shown on the form.

To reset everything, restart the mock (`pnpm dev` or `pnpm mock`).
