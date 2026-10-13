# F00 — Project Foundation · Intent

**Status:** Signed off: 2026-10-13 (user)

## Why
Every later feature needs the same scaffolding, conventions and test harness. If these are fixed once, sub-agents stay consistent and fast.

## What
- Vite + React 19 + TS (strict) app, pnpm, path aliases, env handling (`.env.example`).
- Tailwind v4 + shadcn/ui set up with **dark-theme design tokens** taken from the current app:
  - Near-black surfaces and a red accent (`#D32F45`-ish).
  - Status colours.
  - Dot-matrix display font for IDs and numbers.
  - Inter or similar for body text.
- TanStack Router shell with routes:
  - `/login`
  - `/forgot-password`
  - `/reset-password`
  - `/accept-invite`
  - `/live-tracking` (default)
  - `/admin/*`
  - `/share/:token` (public, no shell)
- Responsive app layout: a side nav that collapses to a drawer on mobile.
- ESLint (kebab-case file rule), Prettier, Vitest and Playwright configs with the D-011 timeouts.
- `pnpm dev` runs the app and the mock server together (Vite proxy for `/api` and `/ws`).
- A README with setup steps.

## Out of scope
Any feature UI beyond empty route placeholders.

## Done when
- `pnpm dev`, `pnpm lint`, `pnpm test` and `pnpm e2e` all run cleanly. There is one smoke test per runner.
- Lint fails on a non-kebab-case file name.

## Resolved
- Git: **local repository only**, with no remote (D-014). Each feature goes on a feature branch and is merged locally into `main` after sign-off.
