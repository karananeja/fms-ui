# F09 — Conversation log

## 2026-10-13 — Initial run (interrupted)
Agent added `@tanstack/react-table` and `@tanstack/react-virtual` and stopped. Backed up in `fms-ui/.recovery/2026-10-14/f09-tracked.patch`.

## 2026-10-14 — Recovery and implementation
**User:** finish F08 then F09 end to end, prioritising speed; F09 independent of F08 on its own branch; no shared-architecture changes without approval.

- Milestone 0 `f47b633`: the approved dependency change committed as-is (SHA-256 = manifest).
- Milestone 1 (worker): `config/table-columns.ts` (ids, labels, defaults, `cellText` shared by table + CSV), `worker/table-query.ts` (cached order of **vehicle ids** per scope/bbox/sort, rebuilt when data changes at most every 1 s; windows read live; only `filters.matches(i)`), `worker/csv-exporter.ts` (RFC 4180, the table's own order, yields every 10 000 rows, progress callback), `worker/tray-query.ts` (bbox + matches, status priority then recency, bounded top 24). Engine: `setFleetNames`, `queryTable`, `exportCsv`, `getTray`.
- F09-T1/T2/T4 `table-query.test.ts` 12/12. F09-T3 (node, 1 lakh): sort/cache build regno 25.7, fleet 24.9, status 11.2, soc 20.9, gpstime 5.5, location 28.2 ms; window 0.05–0.21 ms; viewport sort 1.9 ms (2 500 rows); export 100 000 × 13 cols 0.55 s (12.4 MB); tray 0.87–2.41 ms.
