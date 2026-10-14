import {
  cellText,
  COLUMN_BY_ID,
  type TableColumnId,
  type TableSort,
} from '../config/table-columns.ts';
import type { FleetState } from './fleet-state.ts';
import type { TableQueryEngine, TableScope } from './table-query.ts';
import type { Bbox } from './worker-api.ts';

export interface CsvRequest {
  scope: TableScope;
  bbox?: Bbox | null;
  sort: TableSort;
  /** Visible columns, in table order. */
  columns: TableColumnId[];
}

export interface CsvResult {
  blob: Blob;
  rows: number;
}

/** Rows between yields, so the worker keeps answering other calls (F09-R5). */
export const CSV_CHUNK_ROWS = 10_000;

/** RFC 4180: quote when the value has a comma, quote, CR or LF; double inner quotes. */
export const csvField = (v: string): string =>
  /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

const csvLine = (values: string[]) => `${values.map(csvField).join(',')}\r\n`;

const yieldToEvents = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * F09-R5: the table's rows (same scope, filter, sort and visible columns) as CSV, built in chunks.
 * Uses the table's cached order, so the file matches what the table shows.
 */
export async function exportCsv(
  req: CsvRequest,
  state: FleetState,
  table: TableQueryEngine,
  fleetNames: Readonly<Record<string, string>>,
  onProgress?: (done: number, total: number) => void,
): Promise<CsvResult> {
  const { ids } = table.orderedIds(req);
  const total = ids.length;
  const parts: string[] = [csvLine(req.columns.map((c) => COLUMN_BY_ID[c].label))];
  let rows = 0;
  for (let start = 0; start < total; start += CSV_CHUNK_ROWS) {
    let chunk = '';
    for (let k = start; k < Math.min(total, start + CSV_CHUNK_ROWS); k++) {
      const i = state.byVehicle.get(ids[k]!);
      if (i === undefined) continue; // removed since the order was built
      const row = table.row(i);
      chunk += csvLine(req.columns.map((c) => cellText(c, row, fleetNames)));
      rows++;
    }
    parts.push(chunk);
    onProgress?.(Math.min(total, start + CSV_CHUNK_ROWS), total);
    if (start + CSV_CHUNK_ROWS < total) await yieldToEvents();
  }
  return { blob: new Blob(parts, { type: 'text/csv;charset=utf-8' }), rows };
}
