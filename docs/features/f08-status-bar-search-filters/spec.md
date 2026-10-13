# F08 — Status Bar: Search, Status Pills, Fleet Pulse, Filters · Spec

| Field | Value |
|---|---|
| Status | **Signed off: 2026-10-13 (user)** |
| Intent | `intent.md` (signed off 2026-10-13, plus the mockup v2 design note) |
| Visual source of truth | `docs/design/design-direction.html` v2: search box and status pills (top), Fleet pulse card (top left) |
| Branch / delivery | `feature/f08-search-filters`, **in parallel with F09** from a shared filter-contract commit (§5, D-055) |

## 1. Files (kebab-case)
```
src/features/live-tracking/
  worker/filter-engine.ts         (contract commit) VehicleFilter → Uint8Array match mask, filtered status counts
  worker/search-index.ts          sorted prefix index per field (vin, regno, deviceId)
  store/fleet-pulse.ts            pure ring buffer of running-count samples (since page load)
  components/search-box.tsx       field selector + suggestions dropdown
  components/status-pills.tsx
  components/fleet-pulse-card.tsx
  components/filter-panel.tsx     fleet tree, asset type, fuel, make/model, SOC range
  components/active-filter-chips.tsx
```

## 2. Requirements

### Worker
| ID | Requirement |
|---|---|
| F08-R1 | **`VehicleFilter`** (contract, §5): `{ statuses?, fleetIds?, assetTypes?, fuelTypes?, makes?, models?, socMin?, socMax?, search? }`, where `search` is `{ field: 'all' \| 'vin' \| 'regno' \| 'deviceId', prefix }`.<br>• Fields are combined with AND.<br>• Values inside one field are combined with OR.<br>• `fleetIds` include their whole subtree (the fleet tree comes from `/api/fleets`). |
| F08-R2 | **`FilterEngine`** keeps a `Uint8Array` mask: 1 = matches.<br>• Changing the filter recomputes the mask in one pass, ≤ 100 ms at 1 lakh vehicles.<br>• Updated rows are re-checked one at a time, and removals stay consistent.<br>• It exposes `matches(i)`, `version` and `matchCount`. |
| F08-R3 | **Counts** are computed over every filter **except** `statuses`, so the pills show how many vehicles each status would add. `total` = the count over all filters. Pushes add `filteredCounts` and `filteredTotal`; the unfiltered counts from F05 stay as they are. |
| F08-R4 | **Map uses the filter:** `MapIndex` rebuild, the zoom-15+ live scan and `bounds()` only include matching vehicles. A filter change forces an immediate rebuild, like D-063. Zoom-to-fit therefore fits the filtered set. |
| F08-R5 | **`search-index`:**<br>• Prefix match, case-insensitive, on upper-cased keys using sorted arrays and binary search.<br>• The index is rebuilt lazily when vehicles are added or removed.<br>• `suggest(prefix, field, limit = 8)` returns `{vehicleId, regno, vin, deviceId, status, matchedField}`, sorted by matched field then value.<br>• Results arrive in ≤ 50 ms at 1 lakh vehicles. |
| F08-R6 | **Worker API additions:** `setFilter(filter)`, `suggest(prefix, field, limit)`, and `getFilterOptions()`. The options are the distinct asset types, fuel types, makes and models in the fleet state. |

### Main thread / UI
| ID | Requirement |
|---|---|
| F08-R7 | **Store:**<br>• Holds `filter`, `filteredCounts`, `filteredTotal`, `filterOptions` and `pulse` (samples).<br>• Exposes `setFilter`, `patchFilter`, `clearFilter`, `toggleStatus` and `suggest`.<br>• The filter is session state, not kept in the URL (out of scope). |
| F08-R8 | **Search box** (top-left map slot, `data-slot="map-search"`):<br>• Glass, placeholder `VIN · REG NO · DEVICE ID`, `/` shortcut, and a field selector (ALL / VIN / REG / DEVICE).<br>• Typing (debounced 120 ms) shows up to 8 suggestions: a status dot, regno, VIN and device ID, with the matched part highlighted.<br>• Choosing a suggestion calls `store.locateVehicle`, which selects and flies to it (F06).<br>• **Enter** applies the prefix as a filter, shown as an active chip.<br>• Arrow keys and Esc work; the box uses combobox ARIA. |
| F08-R9 | **Status pills** (top map slot, `data-slot="map-status-chips"`):<br>• ALL (filled teal when no status filter), then one pill per status with a dot, label and live count from `filteredCounts`, in `VEHICLE_STATUSES` order.<br>• Clicking toggles a status in the filter, and several can be selected; ALL clears them.<br>• Pills that don't fit the width collapse into a `+N` popover.<br>• On mobile, the row scrolls horizontally with short counts (`34.6K`). |
| F08-R10 | **Fleet pulse card** (desktop, below the search box, collapsible, collapsed state remembered in localStorage):<br>• "FLEET PULSE" label, with the scope label on the right: the selected fleet name, or "ALL FLEETS".<br>• A big `filteredTotal`.<br>• A stacked status bar and a 2-column legend with counts.<br>• "Running · last hour" sparkline from `pulse`, sampled every 10 s since page load, keeping 1 h. It shows the change since the first sample.<br>• With fewer than 2 samples it says "Collecting…". **Nothing is invented.** |
| F08-R11 | **Filter panel:** a glass popover from a Filters button next to the search, on desktop; a sheet on mobile. It contains:<br>• **Fleet:** a checkbox tree of permitted fleets, ≤ 5 levels, with search.<br>• **Asset type, Fuel type, Make, Model:** multi-selects from `filterOptions`. Models are narrowed by the chosen makes.<br>• **SOC range:** a dual slider, 0–100.<br>• Apply and Reset buttons. |
| F08-R12 | **Active filter chips:** a row under the top bar (fleet names, types, SOC range, search) with a remove button on each, plus "Clear all". It is hidden when no filter is set. |
| F08-R13 | **When the selected vehicle stops matching**, it stays selected (the panel stays open), but its marker is hidden. The panel shows a "Hidden by filters" hint. |

## 3. Budgets
- At 1 lakh vehicles: search suggestions ≤ 50 ms, applying a filter ≤ 100 ms (worker time), and the next map frame ≤ 200 ms after a filter change.
- No main-thread long task > 50 ms while typing or filtering.

## 4. Acceptance tests
| ID | Type | Test |
|---|---|---|
| F08-T1 | unit | `filter-engine`:<br>• Each field type, AND across fields, OR within a field, and fleet subtrees.<br>• The mask stays consistent across random insert, update and remove.<br>• Counts leave out the status filter; `filteredTotal` includes it. |
| F08-T2 | unit | `search-index`: prefix on each field and on "all", case-insensitive, ordering, limit, and correctness after insert/remove. |
| F08-T3 | perf | At 100 000 synthetic vehicles: applying a filter ≤ 100 ms and a suggestion ≤ 50 ms. The times are reported. |
| F08-T4 | unit | Map-index honours the mask: clusters, scan and bounds only include matches. A filter change forces a rebuild. |
| F08-T5 | unit | Store: `toggleStatus`, `patchFilter` and `clearFilter` produce the right `VehicleFilter`. The pulse buffer caps at 1 h and samples every 10 s. |
| F08-T6 | component | Search box keyboard flow (type, arrows, Enter, Esc). Pills toggle, and ALL clears. The `+N` overflow works. The filter panel produces the expected filter. Chips remove filters. |
| F08-T7 | e2e | Type a known regno prefix, and the suggestions appear. Choosing one opens the panel at zoom 16. Enter adds a search chip, the pill counts change, and the map shows fewer clusters/points. |
| F08-T8 | e2e | Toggling RUNNING and CHARGING makes the sum of the pill counts equal the ALL count. Zoom-to-fit then fits the filtered set. Clear all restores the totals. |
| F08-T9 | e2e | Filter panel: choose a fleet and a SOC range, and the counts drop, with matching chips shown. On mobile (390 px), the pills scroll and the panel opens as a sheet. |
| F08-T10 | e2e | Screenshots for UAT, saved to `docs/features/f08-status-bar-search-filters/screenshots/`: the top bar with suggestions open, the Fleet pulse card, the filter panel, active chips, and mobile. |
| F08-T11 | cmd | `pnpm check` and `pnpm build` pass, plus e2e with `--project=chromium --project=clock --no-deps`. Perf is run once by the orchestrator after merging. |

## 5. Shared contract for running in parallel with F09
The orchestrator commits this **before** either agent starts:
- `worker/filter-engine.ts` exports `VehicleFilter` and `class FilterEngine` with `set(filter)`, `matches(i)`, `version` and `matchCount`. In the contract it is a match-all stub; **F08 implements the matching.**
- The engine has a `filters` instance. `MapIndex` receives `filters.matches` (F08 wires it in).
- **F09 may only call** `filters.matches(i)` and read `filters.version`. It must never change filter semantics.

## 6. Out of scope
- Filters in the URL, and saved filter presets.
- Server-side filtering: the mock sends the whole fleet scope.
- Search on fields other than VIN, regno and device ID.
