import { memo } from 'react';
import type { Cell } from '../lib/vehicle-details-model';

/** 20-cell voltage bars; the lowest cell in `--warn` (F07-R10). */
export const CellStrip = memo(function CellStrip({ cells }: { cells: Cell[] }) {
  if (!cells.length) return <p className="text-xs text-text-muted">No cell voltages</p>;
  const vs = cells.map((c) => c.volts);
  const lo = Math.min(...vs);
  const span = Math.max(Math.max(...vs) - lo, 0.01);
  const w = 300 / cells.length;
  const low = cells.find((c) => c.lowest)!;
  return (
    <svg
      viewBox="0 0 300 70"
      width="100%"
      height="70"
      role="img"
      aria-label={`${cells.length} cells, lowest ${low.label} at ${low.text} V`}
      data-testid="cell-strip"
    >
      {cells.map((c, k) => {
        const h = 18 + ((c.volts - lo) / span) * 46;
        return (
          <rect
            key={c.key}
            x={k * w}
            y={66 - h}
            width={w - 4}
            height={h}
            rx="2"
            data-lowest={c.lowest || undefined}
            style={{
              fill: c.lowest ? 'var(--warn)' : 'var(--accent)',
              opacity: c.lowest ? 1 : 0.75,
            }}
          >
            <title>{`${c.label} · ${c.text} V`}</title>
          </rect>
        );
      })}
    </svg>
  );
});
