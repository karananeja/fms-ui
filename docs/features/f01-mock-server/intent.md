# F01 — Mock Server & API/WS Contract · Intent

**Status:** Signed off: 2026-10-13 (user)

## Why
There is no backend spec (A1). A realistic mock lets the UI be built and load-tested now. The contract it defines can later be handed to the backend team.

## What
- A `shared/` package of zod schemas and TS types for every REST and WS message. This is the single source of truth for the contract.
- A Fastify server with cookie-session REST for:
  - Auth: login, logout, me, forgot, reset, accept-invite.
  - Users, invites, roles and permissions.
  - The fleet tree (≤ 5 levels).
  - Share links (create, list, revoke, public fetch).
- WS `/ws/live`, authenticated by the session cookie or by a share token:
  - Topics: `combinfo` and `lafparsed`.
  - Scopes: fleet and vehicle.
  - The fleet scope sends **slim** records as a chunked snapshot followed by batched deltas.
  - The vehicle scope sends the **full** payloads, shaped exactly like `caninfo.md` and `lafparsed.md`.
- Synthetic data generator:
  - About 1 lakh vehicles across India, with a configurable count (up to 10 lakh).
  - A 5-level fleet tree.
  - Vehicles that move, stop, charge, lose GPS, go non-comm, get immobilised and get pulled out, so that every status occurs.
- Forgot-password emails are not sent. The mock logs the reset link to the console and exposes it via a dev-only endpoint for e2e tests.
- Seed users: one super admin, plus users scoped to sub-fleets with limited permissions.

## Out of scope
- Persistence beyond memory (the mock resets on restart).
- Real email.

## Done when
- Contract schemas are documented in the F01 spec.
- The server serves 1 lakh vehicles with configurable update rates.
- Contract tests validate every message against the zod schemas.
