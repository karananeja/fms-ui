import { useNavigate } from '@tanstack/react-router';
import { datasetFields, type CustomSpec, type FieldDef } from '@shared/contract/widget-grammar.ts';
import type { Cell, ShapeGroup } from '@shared/domain/widget-shape.ts';
import { useCan } from '@/features/access/permissions/can';
import { formatNum } from '@/features/analytics/lib/chart-scale';
import { cn } from '@/shared/lib/utils';
import {
  bucketLabel,
  categoryColor,
  cellLabel,
  type Labeller,
} from './custom-format';

/** F26 marks without axes: number, gauge, pie / donut, heatmap, table. */

export function NumberMark({ text, caption, total }: { text: string; caption: string; total: number }) {
  return (
    <div className="flex h-full flex-col justify-center" data-testid="custom-number" data-total={total}>
      <p className="font-display text-3xl leading-none font-extrabold tabular-nums">{text}</p>
      <p className="mt-1.5 truncate text-[11px] text-text-faint">{caption}</p>
    </div>
  );
}

export function GaugeMark({ value, max, text }: { value: number | null; max: number; text: string }) {
  const R = 40;
  const C = Math.PI * R;
  const frac = value === null ? 0 : Math.max(0, Math.min(1, value / max));
  return (
    <div className="grid h-full place-items-center" data-testid="custom-gauge" role="img" aria-label={`${text} of ${formatNum(max)}`}>
      <svg viewBox="0 0 100 60" className="h-full max-h-40 w-auto">
        <path d="M10 52 A40 40 0 0 1 90 52" fill="none" strokeWidth="10" strokeLinecap="round" style={{ stroke: 'var(--tile)' }} />
        <path
          d="M10 52 A40 40 0 0 1 90 52"
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${frac * C} ${C}`}
          style={{ stroke: 'var(--accent)' }}
        />
        <text x="50" y="50" textAnchor="middle" fontSize="13" fontWeight="800" className="font-display" style={{ fill: 'var(--text)' }}>
          {text}
        </text>
      </svg>
    </div>
  );
}

export function PieMark({
  groups,
  field,
  donut,
  labeller,
  fd,
  format,
}: {
  groups: ShapeGroup[];
  field: string;
  donut: boolean;
  labeller: Labeller;
  fd: FieldDef | undefined;
  format: (v: number | null) => string;
}) {
  const R = 42;
  const C = 2 * Math.PI * R;
  const total = groups.reduce((s, g) => s + Math.max(0, g.value ?? 0), 0);
  const lens = groups.map((g) => (total ? (Math.max(0, g.value ?? 0) / total) * C : 0));
  const offsets = lens.map((_, k) => lens.slice(0, k).reduce((a, b) => a + b, 0));
  return (
    <div className="flex h-full min-h-0 items-center gap-4" data-testid="custom-pie">
      <svg viewBox="0 0 120 120" aria-hidden className="h-full max-h-40 min-h-0 w-auto shrink-0">
        {groups.map((g, k) => (
          <circle
            key={k}
            cx="60"
            cy="60"
            r={donut ? R : R / 2}
            fill="none"
            strokeWidth={donut ? 14 : R}
            strokeDasharray={donut ? `${lens[k]} ${C - lens[k]!}` : `${lens[k]! / 2} ${C / 2}`}
            strokeDashoffset={donut ? -offsets[k]! : -offsets[k]! / 2}
            transform="rotate(-90 60 60)"
            style={{ stroke: categoryColor(field, g.key, k) }}
          />
        ))}
        {donut && (
          <text x="60" y="64" textAnchor="middle" fontSize="12" fontWeight="800" className="font-display" style={{ fill: 'var(--text)' }}>
            {format(total)}
          </text>
        )}
      </svg>
      <ul className="widget-no-drag min-w-0 flex-1 space-y-1 overflow-auto text-xs">
        {groups.map((g, k) => (
          <li key={k} className="flex items-center gap-1.5" data-testid="custom-legend-item">
            <span className="size-2 shrink-0 rounded-full" style={{ background: categoryColor(field, g.key, k) }} />
            <span className="flex-1 truncate text-text-muted">{cellLabel(field, g.key, fd, labeller)}</span>
            <span className="font-semibold tabular-nums">{format(g.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HeatmapMark({
  groups,
  field,
  bucket,
  labeller,
  fd,
  format,
}: {
  groups: ShapeGroup[];
  field: string;
  bucket: 'hour' | 'day' | 'week';
  labeller: Labeller;
  fd: FieldDef | undefined;
  format: (v: number | null) => string;
}) {
  const keys = [...new Set(groups.map((g) => g.key))];
  const buckets = [...new Set(groups.map((g) => g.bucket!))].sort((a, b) => a - b);
  const at = new Map(groups.map((g) => [`${g.key}|${g.bucket}`, g.value]));
  const max = Math.max(1, ...groups.map((g) => g.value ?? 0));
  return (
    <div className="widget-no-drag h-full overflow-auto" data-testid="custom-heatmap">
      <table className="w-full border-separate border-spacing-0.5 text-[10px]">
        <thead>
          <tr>
            <th />
            {buckets.map((b) => (
              <th key={b} scope="col" className="font-normal whitespace-nowrap text-text-faint">
                {bucketLabel(b, bucket)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={String(k)}>
              <th scope="row" className="pr-1 text-left font-normal whitespace-nowrap text-text-muted">
                {cellLabel(field, k, fd, labeller)}
              </th>
              {buckets.map((b) => {
                const v = at.get(`${k}|${b}`) ?? null;
                return (
                  <td
                    key={b}
                    title={format(v)}
                    className="h-5 min-w-5 rounded-sm"
                    style={{
                      background: 'var(--accent)',
                      opacity: v ? 0.15 + 0.85 * (v / max) : 0.06,
                    }}
                  >
                    <span className="sr-only">{format(v)}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Rows (columns) or groups (key + value), styled like the F20 vehicle list. */
export function TableMark({
  spec,
  rows,
  groups,
  labeller,
  format,
  footer,
}: {
  spec: CustomSpec;
  rows: Record<string, Cell>[] | null;
  groups: ShapeGroup[] | null;
  labeller: Labeller;
  format: (v: number | null) => string;
  footer: string;
}) {
  const fields = datasetFields(spec.data);
  const navigate = useNavigate();
  const canOpen = useCan('live.view');
  const shape = spec.shape ?? {};
  const head = 'px-2 text-[11px] font-semibold tracking-[0.06em] whitespace-nowrap text-text-muted uppercase';
  const groupHeads = [
    ...(shape.groupBy ? [fields[shape.groupBy]?.label ?? shape.groupBy] : []),
    ...(shape.timeBucket ? [shape.timeBucket] : []),
    'Value',
  ];
  const columns = spec.mark.columns ?? [];
  const open = (vehicleId: Cell) =>
    typeof vehicleId === 'string' &&
    void navigate({ to: '/live-tracking', search: { vehicle: vehicleId } });
  const clickable = canOpen && spec.data.dataset === 'live-vehicles';
  return (
    <div className="flex h-full flex-col">
      <div className="widget-no-drag min-h-0 flex-1 overflow-auto">
        <table className="w-full text-xs" data-testid="custom-table">
          <thead className="sticky top-0 bg-surface-solid">
            <tr className="h-8 border-b border-glass-border">
              {(groups ? groupHeads : columns.map((c) => fields[c]?.label ?? c)).map((h, k, all) => (
                <th key={k} scope="col" className={cn(head, k === all.length - 1 && groups ? 'text-right' : 'text-left')}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups?.map((g, k) => (
              <tr key={k} data-testid="custom-row" className="h-7 border-b border-glass-border/50 last:border-b-0">
                {shape.groupBy && (
                  <td className="px-2 whitespace-nowrap">{cellLabel(shape.groupBy, g.key, fields[shape.groupBy], labeller)}</td>
                )}
                {shape.timeBucket && <td className="px-2 whitespace-nowrap">{bucketLabel(g.bucket!, shape.timeBucket)}</td>}
                <td className="px-2 text-right font-semibold tabular-nums">{format(g.value)}</td>
              </tr>
            ))}
            {rows?.map((r, k) => (
              <tr
                key={k}
                data-testid="custom-row"
                tabIndex={clickable ? 0 : undefined}
                onClick={clickable ? () => open(r.vehicleId ?? null) : undefined}
                onKeyDown={(e) => {
                  if (clickable && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    open(r.vehicleId ?? null);
                  }
                }}
                className={cn(
                  'h-7 border-b border-glass-border/50 outline-none last:border-b-0',
                  clickable && 'cursor-pointer hover:bg-tile focus-visible:bg-tile',
                )}
              >
                {columns.map((c) => (
                  <td
                    key={c}
                    className={cn(
                      'px-2 whitespace-nowrap',
                      fields[c]?.type === 'number' && 'text-right tabular-nums',
                      (c === 'regno' || c === 'name') && 'font-semibold',
                    )}
                  >
                    {cellLabel(c, r[c] ?? null, fields[c], labeller)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="shrink-0 pt-1.5 text-[11px] text-text-faint" data-testid="custom-footer">
        {footer}
      </p>
    </div>
  );
}
