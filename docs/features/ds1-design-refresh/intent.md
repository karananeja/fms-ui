# DS1 — Design Refresh ("Dark ops console") · Intent

**Status:** Awaiting sign-off

## Why
The look built so far (F00 tokens, F06 map styling, F07 panel) was copied from the current app's screenshots. Those were meant **only as reference**, and the user wants a distinctly different design (user correction, 2026-10-13).

## What
Restyle the whole app to the approved mockup, `docs/design/design-direction.html`:
- **Theme:** dark ops console, with translucent "glass" panels floating over a dark map, and a single **teal** accent. Red is used only for problems.
- **Fonts:** Inter for UI text, with tabular numbers for metrics. JetBrains Mono only for IDs and raw parameter values. The dot-matrix font is retired.
- **New status colours**, with clearer separation between them: running green, stopped red, immobilized violet, non-comm slate, charging blue, pullout orange, no-gps yellow, gps-never dim slate.
- **App shell:** a 64 px icon rail with a teal active indicator. Top-of-map glass slots for search and status chips; F08 fills them.
- **Map (re-styles F06):**
  - Status-coloured chevrons and dots with a dark outline. Non-comm vehicles are drawn as a dashed ring.
  - Glass donut clusters.
  - Teal selection ring.
  - A glass tool stack at bottom left (zoom, fit), plus a glass "Jump to city…" button.

## Out of scope
- New behaviour: everything works exactly as accepted in F00–F06.
- Light theme (D-008 stands).

## Done when
- F00 and F06 screens match the mockup's look.
- All existing tests pass, and the F04–F06 budgets still hold.
- The user accepts it from screenshots and the running app.
