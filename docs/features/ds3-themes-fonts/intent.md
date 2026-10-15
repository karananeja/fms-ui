# DS3 — Themes & Fonts · Intent

**Status:** Signed off: 2026-10-15 (user)

## Why
The DS1 "dark ops console" is too dark for daytime office use, and Doto everywhere hurts readability in tables, forms and chat.

## What
- **Themes:** Light, Dark and System (follows the OS), with System as the default. A switch in the header (sun / moon / monitor). The choice is saved per browser and applied before first paint, so there is no flash of the wrong theme.
- **Light palette:** a light version of every DS1 token in `theme.css` (surfaces, glass, text, accent, status colours, shadows), checked for WCAG AA contrast. Every page uses it: app shell, live map, panels, table, admin, analytics, requests, assistant, driver page and auth screens (including the DS2 backdrop).
- **Map:** the light theme uses a light OpenFreeMap basemap (e.g. `positron`). Switching theme swaps the style without losing markers, the selection or the viewport.
- **Fonts:**
  - **Inter** (Google Fonts, `<link>` with preconnect in `index.html`, no npm package) is the body font everywhere: text, tables, forms, chat and numbers in tables.
  - **Doto** stays only where it reads as a display face: the brand mark, page titles, big KPI numbers and status counter numbers.
  - Supersedes D-054.
- The public share page keeps its own light look (D-090), but switches to the new fonts.

## Out of scope
Per-user theme stored on the server, custom accent colours, high-contrast mode.

## Done when
- Every page has been checked in both themes (screenshots in the test report). There is no hard-coded dark colour left outside `theme.css`.
- Switching theme on the live map keeps markers, the selection and the viewport.
- Existing e2e and perf budgets still pass.
