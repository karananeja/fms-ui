# DS3 — Themes & Fonts · Conversation log

## 2026-10-15 — Implementation (agent, branch `feature/part3-ds3-f18`, ports 5273/4101)
**User (via orchestrator):** "Implement feature DS3 'Themes & Fonts' … source of truth `spec.md` (§10 resolved questions override) … F18 runs in parallel in the same checkout (disjoint files) … no commits."

**Assistant:** Implemented the signed-off spec:
- **Theme mechanism:** pre-paint inline script in `index.html` (`fms.theme` → `data-theme` + `theme-color`, falls back to `dark`), `class="dark"` removed. React-free `ThemeStore` (`src/shared/theme/theme-store.ts`, `use-theme.ts`) with `matchMedia` (System only) and `storage` (other tabs) listeners; created at app and driver boot. Share page never imports it.
- **Tokens:** `:root[data-theme='light']` block (spec §2 values, teal-700 accent, darker status colours) plus new `--scrim`, `--elev-panel`, `--elev-float`, `--on-danger`, dark `--marker-ring`; Tailwind `bg-scrim`, `text-on-danger`, `shadow-panel`, `shadow-float`.
- **Hard-coded colours:** 17 arbitrary shadows → `shadow-panel`/`shadow-float`, 7 `bg-black/*` overlays → `bg-scrim`, 2 `text-white` → `text-on-danger`, button `dark:` variants removed; Sonner follows the resolved theme.
- **Toggle:** `src/shared/ui/theme-toggle.tsx` (radio group Light/Dark/System with arrow keys; one cycling button below 640 px with a live announcement). In the app header (before Ask FMS), the user menu (rail popover and drawer) and the driver header.
- **Fonts:** Inter via Google Fonts `<link>` + preconnects; Doto trimmed to 800/900 and used only via `font-display` (brand, page titles, big KPI numbers, status-counter numbers). Body Inter 400, no tracking; sweep `font-black`/`font-extrabold` → `font-semibold`, uppercase tracking 0.12–0.16em → 0.06em across ~74 files. Regnos use Inter (§10.4).
- **Map:** `MapController.setTheme()` remembers the camera, `setStyle(url, {diff:false})`, re-installs images/sources/layers (fresh token colours, trail, 3D buildings) on `style.load`, re-renders the last snapshot, restores the camera without sending a viewport. Cluster donuts now use `stroke:var(--st-…)`. Request mini-map swaps too; auth backdrop recolours its dots in place. Dev debug overlay shows "Theme swaps".
- **Tests:** `theme-tokens.node.test.ts` (DS3-T1/T2, tightened regex + palette-class + `dark:` guard), `theme-store.test.ts`, `theme-boot.test.ts`, `theme-toggle.test.tsx`, `e2e/themes.spec.ts` (T4–T9); DS1-T2 e2e updated to Inter; share isolation check extended to `shared/theme`. Playwright: `colorScheme: 'dark'`, `VITE_MAP_STYLE_URL_LIGHT`, F18's `MOCK_DB: ':memory:'`; fixtures stub Google Fonts unless `FMS_E2E_FONTS=1`.

**Status/Next:** Implemented and tested (see `test-report.md`); 50 screenshots in `screenshots/`. Awaiting UAT.
