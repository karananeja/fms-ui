# F00 — Project Foundation · Implementation Log

Implementation sub-agent, 2026-10-13, branch `feature/f00-project-foundation`.

1. **Read inputs** — spec, intent, architecture §2/§3/§7, decision log. Viewed `reference/current-app-view.png` for visual feel only.
2. **Package + deps** — wrote root `package.json` (scripts per F00-R16, `pnpm.onlyBuiltDependencies: [esbuild]`). Installed React 19.3, TanStack Router 1.170, Vite 8.3, Tailwind 4.3, Vitest 5.0, Playwright 1.64, ESLint 10 + typescript-eslint 8.71, eslint-plugin-check-file 3.3, Fastify 5.12, tsx, concurrently.
   - Problem: `typescript@latest` is 7.0.2, outside typescript-eslint's peer range (`<6.1.0`). Fix: pinned `typescript@~6.0` (D-021).
3. **TS config** — `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `@/` and `@shared/` paths), `tsconfig.app.json` (src + shared), `tsconfig.node.json` (mock-server, shared, e2e, configs); root `tsconfig.json` with references and paths (paths needed by the shadcn CLI).
4. **Vite/Vitest/Playwright configs** — aliases, `/api` + `/ws` (ws: true) proxy to `127.0.0.1:MOCK_PORT`; Vitest merges the Vite config (jsdom, 5 s / 10 s timeouts, includes per F00-R14); Playwright per F00-R15.
   - Vite warned about importing `./vite.config` without extension → imported `./vite.config.ts`.
5. **Mock stub** — `mock-server/build-server.ts` (Fastify, `GET /api/health`), `index.ts` loads `.env` if present and listens on `MOCK_PORT`; run via `tsx watch`.
6. **Theme** — tokens + status colours in `src/shared/styles/theme.css`, shadcn semantic aliases mapped onto them; Tailwind `@theme inline` exposes `bg-surface-1`, `text-text-muted`, `bg-st-running`, `font-display`, etc. Fonts self-hosted via Fontsource (D-019).
7. **shadcn/ui** — wrote `components.json`, ran `shadcn add button sheet`.
   - Problem: CLI wrote files to a literal `@/shared/ui/` folder and imported `cn` from a bogus `cn` npm package (root tsconfig lacked paths at that point). Fix: moved files to `src/shared/ui/`, rewrote imports to `@/shared/lib/utils`, removed `cn` and the unused `@radix-ui/react-slot`, added paths to root tsconfig (D-022).
8. **formatIst** — `Intl.DateTimeFormat` parts in Asia/Kolkata.
   - Problem: `en-GB` yields `Sept` with current ICU. Fix: use `en-US` parts (order irrelevant since parts are assembled manually); added a September test.
9. **Router + layout** — code-based routes (auth/public/share without shell; `app` pathless layout for `/live-tracking` and `/admin/*`; `/` redirects; root `notFoundComponent`). Titles via `staticData.title`; `PlaceholderPage` reads it. `AppLayout`: icon side nav (`lg:`), shadcn Sheet drawer from top-bar menu button below 1024 px, top-bar title, page-actions slot exposed through `<PageActions>` portal.
   - Problem: a generic route-factory helper erased literal path types (Link `to` errors). Fix: declared routes explicitly.
10. **Lint/format** — flat config with typescript-eslint, react-hooks, react-refresh, check-file (kebab-case files + folders under src/shared/mock-server/e2e), eslint-config-prettier; react-refresh rule off for shadcn primitives. Prettier + tailwind plugin; ran `pnpm format`.
    - T3 verified: `src/BadName.ts` → lint exit 1; deleted. Also verified a `src/BadDir/` folder fails.
11. **Tests** — unit (formatIst, app shell smoke, mock stub via `inject`) and e2e (`e2e/app-shell.spec.ts`).
    - Problem: jsdom "Not implemented: window.scrollTo" noise → stubbed in `test-setup.ts`; that broke the node-env mock test (`window is not defined`) → guarded with `typeof window`. Fixed on first retry.
12. **Manual check** — ran `pnpm dev` in background, screenshot desktop/mobile/404 via Playwright, `curl /api/health` → `{"ok":true}`; killed servers, ports 5173/4000 confirmed free.
13. **Results** — `pnpm check` 0, `pnpm build` 0, `pnpm e2e` 3/3. See `test-report.md`.
14. **Docs** — README, decision log D-019…D-022 (Proposed), catalogue row F00 → Done / Passed.
