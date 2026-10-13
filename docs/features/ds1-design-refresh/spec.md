# DS1 — Design Refresh · Spec

| Field | Value |
|---|---|
| Status | **Signed off: 2026-10-13 (user)** |
| Intent | `intent.md` |
| Mockup | `docs/design/design-direction.html` (**v2**). Open it in a browser. **This is the visual source of truth.** |
| Branch | `feature/ds1-design-refresh` |
| Supersedes | F00 spec §2 (tokens), the marker/cluster/toolbar look in D-046, and D-046's "pitch off" (now a 2D/3D toggle) |

## 1. Tokens (`src/shared/styles/theme.css`)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0a0c10` | app background |
| `--map-bg` | `#0f1318` | map background before tiles load |
| `--glass` | `rgba(18,22,29,0.72)` + `backdrop-filter: blur(16px) saturate(140%)` | floating panels |
| `--glass-strong` | `rgba(18,22,29,0.88)` | cluster centres, menus, and the fallback when `backdrop-filter` is unsupported |
| `--glass-border` | `rgba(255,255,255,0.08)` | panel borders |
| `--surface-solid` | `#12161c` | rail, non-floating surfaces |
| `--tile` / `--tile-border` | `rgba(255,255,255,0.035)` / `rgba(255,255,255,0.06)` | metric tiles inside panels |
| `--text` / `--text-muted` / `--text-faint` | `#e6eaf0` / `#8a94a6` / `#5b6577` | text |
| `--accent` / `--accent-soft` | `#2dd4bf` / `rgba(45,212,191,0.12)` | the only accent: active states, primary CTA, focus ring, selection |
| `--ok` / `--warn` / `--danger` | `#34d399` / `#fbbf24` / `#f87171` | value semantics |
| `--radius-panel` / `--radius-tile` | `18px` / `12px` | |
| `--font-sans` | **Doto** (`@fontsource/doto`, weights 600/700/800/900) | **all** text: body 600, labels 800 uppercase + 0.12em tracking, figures 900 |
| `--accent-2` | `#38bdf8` | second stop of the primary gradient (teal→sky) |

Status colours (`--st-*`):

| Status | Colour |
|---|---|
| running | `#4ade80` |
| stopped | `#f87171` |
| immobilized | `#c084fc` |
| non-comm | `#64748b` |
| charging | `#60a5fa` |
| pullout | `#fb923c` |
| no-gps | `#facc15` |
| gps-never | `#475569` |

Rules:
- Inter (`@fontsource-variable/inter`) is removed. `--font-display` is folded into `--font-sans`, so Doto is the only family.
- The minimum font size is 11 px, and text uses weight 600 or more.
- shadcn aliases (`--primary`, `--ring`, …) are remapped to the new tokens.
- A `.glass` utility class provides the glass panel style.
- **No raw hex or rgb colours outside `theme.css`.** A unit test scans `src/**/*.{ts,tsx,css}` to enforce this. Map paint colours are resolved from CSS variables at runtime.

## 2. App shell
| ID | Requirement |
|---|---|
| DS1-R1 | **Desktop rail:** 64 px wide, `--surface-solid`, with a logo tile (teal→sky gradient) and icon-only nav items with tooltips. The active item gets `--accent-soft` plus a 2 px inset teal bar. |
| DS1-R2 | **Mobile (< 1024 px):** the drawer and top bar are restyled with the same tokens. The page title stays visible. |
| DS1-R3 | **Map overlay slots:** `/live-tracking` provides empty, absolutely positioned slots at the top (search on the left, status chips on the right) for F08. They stay hidden until F08 fills them. |

## 3. Map
| ID | Requirement |
|---|---|
| DS1-R4 | **Point icons** (SDF, generated at runtime as before):<br>• Running: chevron arrow, rotated by heading.<br>• Other statuses: a filled dot.<br>• Non-comm: a dashed ring.<br>• All shapes get a 1.5–2 px `--bg` outline, so they read on any tile. |
| DS1-R5 | **Clusters:** a status donut (3.2 px stroke) around a `--glass-strong` centre, with a hairline `--glass-border` and a semibold count. Sizes are 38, 46 or 58 px depending on count. |
| DS1-R6 | **Selection ring:** a 2 px `--accent` ring plus a 6 px `--accent-soft` halo. |
| DS1-R7 | **Tools:** a vertical `.glass` stack at bottom left (zoom +/−, fit), with a `.glass` "Jump to city…" button beside it. The MapLibre default control styling is replaced. On mobile the stack collapses to zoom and fit. |
| DS1-R8 | **Base map:** the OpenFreeMap dark style stays (D-020). Attribution is restyled to `--text-faint` and remains visible. |
| DS1-R9 | **Debug overlay and toasts** use `.glass`. Toasts get the teal accent for success and `--danger` for errors. |
| DS1-R10 | **2D/3D toggle:**<br>• Pitches the map to 55° and adds a `fill-extrusion` building layer, if the style has building data (OpenFreeMap does).<br>• Off by default. The choice is remembered in localStorage.<br>• The blank e2e style degrades gracefully, with no buildings and the pitch only. |
| DS1-R11 | **LIVE indicator:** a glass pill at top right showing the connection state (pulsing teal dot when live) and the rows/s rate (`stats.rowsPerSec`). It replaces the connection badge that was only in the debug overlay. |
| DS1-R12 | *(Reassigned to F07 on 2026-10-13 so one agent owns all selected-vehicle visuals.)* **Selected-vehicle trail layer:** a gradient teal line (fading to transparent at the tail) with a soft wide halo underneath. DS1 adds the layer; F07 rev 3 feeds it data. |

## 4. Acceptance tests
| ID | Type | Test |
|---|---|---|
| DS1-T1 | unit | The token scan finds no raw colour literals outside `theme.css`. `STATUS_META` colours resolve to the new values. |
| DS1-T2 | unit/e2e | Inter is no longer in the bundle. The computed `font-family` of body, buttons, inputs and map labels/tooltips starts with `Doto`. |
| DS1-T3 | e2e | Every existing F00/F04/F05/F06 e2e test passes, with selectors updated only where markup changed. The F04–F06 budgets still hold (numbers recorded). |
| DS1-T4 | e2e | Screenshots saved to `docs/features/ds1-design-refresh/screenshots/` for UAT, next to the mockup: desktop map with clusters, map at zoom 15 with markers and selection, and the 390 px mobile view. |
| DS1-T5 | cmd | `pnpm check`, `pnpm build` and `pnpm e2e` all pass. |

## 5. Then F07
F07 resumes after DS1 is accepted:
- Its branch is rebased onto `main`.
- Its design-dependent WIP components are replaced, following F07 spec revision 2.
