# F03 — Access Control · Test report

F03 was delivered by two agents in parallel from one shared contract commit (spec §5). Per-agent evidence:
- `test-report-f03a.md`: Fleets (T2, T3, fleets screenshots, fleets budgets).
- `test-report-f03b.md`: People (T4–T8, people screenshots).
- Contract (T1): 30 tests in `permissions/can.test.tsx`, `app/nav-items.test.ts` and `app/app.test.tsx`. See `conversation-log.md`.

## Integration (`integration/f03`, 2026-10-14)
Merged `feature/f03a-fleets`, then `feature/f03b-people`. Only the decision log and the conversation log conflicted (both sides appended).

**One integration fix:** the F03-T4 users-panel scope test clicked Delhi to deselect it. With F03a's real picker, Delhi is implied by the chosen North (F03-R7), so its checkbox is disabled. The test now deselects North and expects `['f3', 'f4']`. The F03b e2e invite steps needed no change, because multi-mode rows keep native checkboxes named by the fleet.

| Command | Result |
|---|---|
| `pnpm check` | **619/619**, 52 files, lint clean |
| `pnpm build` | pass; main chunk 658 kB (admin pages are lazy chunks) |
| e2e setup + chromium (`--no-deps`) | **48/48** |
| e2e clock (`--no-deps`) | **3/3** |
| perf (6 specs, run alone) | See below. Results depended on machine load: load avg 5–15, with the editor using about one core. |

**Perf:**
| Spec | Result |
|---|---|
| F04-T9 / F04-T10 / F06-T9 | Failed on the first run at load 14.6 (F04 first data 3.8 s; F06 a 262 ms task). Passed on the second at load ~9: first data 1135 ms, snapshot 1488 ms; 0 long tasks while streaming; F06 0 long tasks. |
| F09-T7 | Passed both runs: no scroll long tasks; export 692–705 ms. |
| F03 fleets budgets | 3 of 4 runs had no long tasks; one run had a single 64 ms task (load ~9). Vehicle pages loaded in 5–19 ms, but the root fleet's empty direct page took 323 ms once (the mock scans all 1 lakh vehicles; budget 300 ms). |
| F08 budgets | Frames after a filter change: 81–167 ms, with one 203 ms "clear" at load ~9. **Long tasks while typing/filtering: 58–84 ms**, failing. **`main` without F03 fails the same check at the same load (62 ms)**, so this is load sensitivity, not an F03 regression. Same pattern as F09 before D-079. |

UAT screenshots: `screenshots/`. People screens were retaken on `integration/f03`, so the invite dialog and user panel show the real fleet picker. The fleets screens are from F03a's fresh-mock run.
