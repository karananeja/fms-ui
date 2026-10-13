# DS1 — Design Refresh ("Dark ops console") · Intent

**Status:** Signed off: 2026-10-13 (user)

## Why
The look built so far (F00 tokens, F06 map styling, F07 panel) was copied from the current app's screenshots. Those were meant **only as reference**, and the user wants a distinctly different design (user correction, 2026-10-13).

## What
Restyle the whole app to the approved mockup, `docs/design/design-direction.html`:
- **Theme:** dark ops console (mockup v2), with glass panels floating over a dark city map and a vignette. The accent is teal, with a teal→sky gradient for primary actions and a teal glow for selection. Red is used only for problems.
- **Font:** **Doto throughout the app** (user request, 2026-10-13), using weights 600–900 for legibility. No second font.
- **New status colours**, with clearer separation between them: running green, stopped red, immobilized violet, non-comm slate, charging blue, pullout orange, no-gps yellow, gps-never dim slate.
- **App shell:** a 64 px icon rail with a teal active indicator. Top-of-map glass slots for search and status chips; F08 fills them.
- **Map (re-styles F06):**
  - Status-coloured chevrons and dots with a dark outline. Non-comm vehicles are drawn as a dashed ring.
  - Glass donut clusters with a soft teal halo.
  - Teal selection ring with glow.
  - A glass tool stack at bottom left: zoom, fit, city jump, a **2D/3D toggle** (pitch + building extrusions), and the table toggle (F09).
  - A glass **LIVE** indicator showing the rows/s rate.

## Out of scope
- New behaviour: everything works exactly as accepted in F00–F06.
- Light theme (D-008 stands).

## Done when
- F00 and F06 screens match the mockup's look.
- All existing tests pass, and the F04–F06 budgets still hold.
- The user accepts it from screenshots and the running app.
