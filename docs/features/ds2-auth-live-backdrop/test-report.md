# DS2 — Test report (2026-10-14)

Built in the main checkout on `feature/f12-f15` (the active branch), touching only auth files + `index.css`. **Ready for UAT.**

| Check | Result |
|---|---|
| Unit: `pnpm vitest run src/features/auth src/shared/styles` | 228/228 (incl. theme-token rules) |
| e2e: `e2e/auth.spec.ts` (setup + chromium, ports 5473/4300) | 8/8: sign-in, errors, forgot/reset and invite flows unchanged |
| Visual check (Playwright, desktop 1280×800 + mobile 390×844) | no page errors. Dots follow the grid lines and turn at intersections, the trails fade, the radar glow is soft; see `screenshots/` |
| Prettier / eslint (auth files, `index.css`) | clean |

**Files:**
- `src/features/auth/components/auth-backdrop.tsx` (new)
- `src/features/auth/components/auth-layout.tsx` (mounts the backdrop, adds `auth-card` and the brand pulse)
- `src/features/auth/components/submit-button.tsx` (`auth-shimmer`)
- `src/index.css` (radar sweep, entrance, staggered fields, shine, reduced-motion overrides)

**Performance notes:**
- One `requestAnimationFrame` loop, ≤ 26 dots × 56 trail points. The device pixel ratio is capped at 2.
- The loop runs only while an auth screen is mounted and pauses in background tabs.
- The time step is clamped, so dots don't jump after a tab switch.
- The canvas is skipped where `matchMedia` is missing (jsdom).

The full `pnpm check` / build / e2e runs together with F12/F15 at that merge. (F15's in-progress files currently fail typecheck; that's unrelated to DS2.)
