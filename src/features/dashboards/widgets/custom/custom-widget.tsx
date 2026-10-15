import { useEffect, useMemo, useRef, useState } from 'react';
import type { Widget } from '@shared/contract/dashboards.ts';
import {
  DATASETS,
  datasetFields,
  followTarget,
  MAP_POINTS_MAX,
  type CustomSpec,
} from '@shared/contract/widget-grammar.ts';
import { applyShape, objectTable, type Cell, type ShapeGroup } from '@shared/domain/widget-shape.ts';
import { formatNum } from '@/features/analytics/lib/chart-scale';
import type { LiveTrackingState } from '@/features/live-tracking/store/live-tracking-store';
import { useLiveTracking } from '@/features/live-tracking/store/use-live-tracking';
import type { LiveCustomQuery, LivePoints } from '@/features/live-tracking/worker/worker-api';
import { useNow } from '@/shared/hooks/use-now';
import { STATE_COPY, WidgetEmpty, WidgetIssueState } from '../../components/widget-states';
import { restRows, timeFieldOf } from '../../data/custom-requests';
import { DataBody } from '../data-body';
import { useLiveWidgetData, useRestWidget } from '../widget-data';
import { CustomChart, type ChartSeries } from './custom-chart';
import { bucketLabel, categoryColor, cellLabel, formatValue, valueFormat, type Labeller } from './custom-format';
import { GaugeMark, HeatmapMark, NumberMark, PieMark, TableMark } from './custom-marks';
import { MapMark } from './map-mark';

type Custom = Extract<Widget, { type: 'custom' }>;

/** What every dataset becomes before a mark draws it. */
export interface CustomResult {
  total: number;
  value: number | null;
  groups: ShapeGroup[] | null;
  rows: Record<string, Cell>[] | null;
  points: LivePoints | null;
  /** The REST source had more rows than were read (D-145). */
  truncated: boolean;
}

const ROW_LIMIT: Partial<Record<CustomSpec['mark']['type'], number>> = { bar: 12, table: 50 };

/** Columns the mark reads from rows. */
function rowFields(spec: CustomSpec): string[] {
  const m = spec.mark;
  return [...new Set([...(m.columns ?? []), m.x, m.y, m.label].filter((f): f is string => !!f))];
}

const withDefaultLimit = (spec: CustomSpec) => {
  const s = spec.shape ?? {};
  const rowsMode = !s.groupBy && !s.timeBucket && !s.aggregate;
  // A number / gauge without an aggregate shows the row count (no rows materialised).
  if (rowsMode && (spec.mark.type === 'number' || spec.mark.type === 'gauge'))
    return { ...s, aggregate: { op: 'count' as const } };
  const lim = ROW_LIMIT[spec.mark.type];
  return rowsMode && s.limit === undefined && lim ? { ...s, limit: lim } : spec.shape;
};

/** The worker query of a `live-vehicles` spec (points for maps, else shaped rows/groups). */
export function customLiveQuery(spec: CustomSpec): LiveCustomQuery {
  const m = spec.mark;
  if (m.type === 'map')
    return {
      kind: 'custom',
      filter: spec.data.filter,
      points: { color: m.color, label: m.label, size: m.size, max: m.follow ? 1 : MAP_POINTS_MAX },
    };
  return { kind: 'custom', filter: spec.data.filter, shape: withDefaultLimit(spec), columns: rowFields(spec) };
}

/** Fleet ids the spec names (for the "Outside your fleets" state). */
const namedFleets = (spec: CustomSpec) =>
  [...(spec.data.filter?.all ?? []), ...(spec.data.filter?.any ?? [])]
    .filter((c) => c.field === 'fleet' && (c.op === 'eq' || c.op === 'in'))
    .flatMap((c) => (Array.isArray(c.value) ? c.value : [c.value]).map(String));

/** Off-screen widgets pause their live query (D-146). */
function useOnScreen(ref: React.RefObject<HTMLElement | null>): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setOn(!!e?.isIntersecting), { rootMargin: '100px' });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return on;
}

const selectFleets = (s: LiveTrackingState) => s.fleets;

function useLabeller(): Labeller {
  const fleets = useLiveTracking(selectFleets);
  return useMemo(() => {
    const names = new Map(fleets.map((f) => [f.id, f.name]));
    return { fleetName: (id) => names.get(id) ?? id };
  }, [fleets]);
}

function LiveCustom({ w, paused }: { w: Custom; paused: boolean }) {
  const query = customLiveQuery(w.spec);
  const state = useLiveWidgetData(w, query, namedFleets(w.spec), paused);
  return (
    <DataBody type="custom" state={state}>
      {(r) =>
        r.kind === 'custom' && (
          <CustomView spec={w.spec} result={{ ...r, truncated: false }} />
        )
      }
    </DataBody>
  );
}

function Shaped({ spec, data }: { spec: CustomSpec; data: unknown }) {
  const now = useNow(60_000);
  const result = useMemo<CustomResult>(() => {
    const { rows, truncated } = restRows(spec, data, now);
    if (spec.mark.type === 'map')
      return { total: rows.length, value: null, groups: null, rows, points: null, truncated };
    const r = applyShape(
      objectTable(rows),
      { filter: spec.data.filter, shape: withDefaultLimit(spec) },
      { timeField: timeFieldOf(spec) },
    );
    return {
      total: r.total,
      value: r.value,
      groups: r.groups,
      rows: r.rows ? r.rows.map((i) => rows[i]!) : null,
      points: null,
      truncated,
    };
  }, [spec, data, now]);
  return <CustomView spec={spec} result={result} />;
}

function RestCustom({ w }: { w: Custom }) {
  const state = useRestWidget<unknown>(w);
  return <DataBody type="custom" state={state}>{(data) => <Shaped spec={w.spec} data={data} />}</DataBody>;
}

/** One mark over a shaped result. */
export function CustomView({ spec, result }: { spec: CustomSpec; result: CustomResult }) {
  const labeller = useLabeller();
  const fields = datasetFields(spec.data);
  const { format: fmt, unit } = valueFormat(spec);
  const format = (v: number | null) => formatValue(v, fmt, unit);
  const shape = spec.shape ?? {};
  const m = spec.mark;
  const noun = spec.data.dataset === 'live-vehicles' ? 'vehicles' : 'rows';
  const more = result.truncated ? ' (top 500 read)' : '';

  if (m.type === 'map') {
    if (m.follow && result.total === 0) return <WidgetIssueState issue="not-found" />;
    return (
      <MapMark
        spec={spec}
        points={result.points}
        trailRows={spec.data.dataset === 'vehicle-history' ? result.rows : null}
        total={result.total}
        labeller={labeller}
      />
    );
  }
  const empty =
    (result.groups && result.groups.length === 0) || (result.rows && result.rows.length === 0);
  if (empty && m.type !== 'number' && m.type !== 'gauge') return <WidgetEmpty text={noun === 'vehicles' ? STATE_COPY.noVehicles : undefined} />;

  switch (m.type) {
    case 'number':
    case 'gauge': {
      const v = result.value ?? result.total;
      const text = format(v);
      const caption = `${formatNum(result.total)} ${noun} matched${more}`;
      return m.type === 'number' ? (
        <NumberMark text={text} caption={caption} total={result.total} />
      ) : (
        <GaugeMark value={v} max={m.max ?? 100} text={text} />
      );
    }
    case 'pie':
    case 'donut':
      return (
        <PieMark
          groups={result.groups ?? []}
          field={shape.groupBy!}
          donut={m.type === 'donut'}
          labeller={labeller}
          fd={fields[shape.groupBy!]}
          format={format}
        />
      );
    case 'heatmap':
      return (
        <HeatmapMark
          groups={result.groups ?? []}
          field={shape.groupBy!}
          bucket={shape.timeBucket!}
          labeller={labeller}
          fd={fields[shape.groupBy!]}
          format={format}
        />
      );
    case 'table':
      return (
        <TableMark
          spec={spec}
          rows={result.rows}
          groups={result.groups}
          labeller={labeller}
          format={format}
          footer={`${formatNum(result.rows?.length ?? result.groups?.length ?? 0)} of ${formatNum(result.total)} ${noun}${more}`}
        />
      );
    case 'bar':
    case 'line':
    case 'area': {
      let labels: string[];
      let series: ChartSeries[];
      const valueLabel = shape.aggregate?.field
        ? (fields[shape.aggregate.field]?.label ?? shape.aggregate.field)
        : 'Count';
      if (result.rows) {
        const x = m.x!;
        const y = m.y!;
        labels = result.rows.map((r) => cellLabel(x, r[x] ?? null, fields[x], labeller));
        series = [
          {
            label: fields[y]?.label ?? y,
            color: 'var(--accent)',
            values: result.rows.map((r) => (typeof r[y] === 'number' ? (r[y] as number) : null)),
          },
        ];
      } else if (shape.timeBucket) {
        const groups = result.groups ?? [];
        const buckets = [...new Set(groups.map((g) => g.bucket!))].sort((a, b) => a - b);
        labels = buckets.map((b) => bucketLabel(b, shape.timeBucket!));
        if (shape.groupBy) {
          const keys = [...new Set(groups.map((g) => g.key))].slice(0, 6);
          const at = new Map(groups.map((g) => [`${g.key}|${g.bucket}`, g.value]));
          series = keys.map((k, i) => ({
            label: cellLabel(shape.groupBy, k, fields[shape.groupBy!], labeller),
            color: categoryColor(shape.groupBy, k, i),
            values: buckets.map((b) => at.get(`${k}|${b}`) ?? 0),
          }));
        } else {
          const at = new Map(groups.map((g) => [g.bucket, g.value]));
          series = [{ label: valueLabel, color: 'var(--accent)', values: buckets.map((b) => at.get(b) ?? null) }];
        }
      } else {
        const groups = result.groups ?? [];
        labels = groups.map((g) => cellLabel(shape.groupBy, g.key, fields[shape.groupBy!], labeller));
        series = [{ label: valueLabel, color: 'var(--accent)', values: groups.map((g) => g.value) }];
      }
      return (
        <div className="flex h-full flex-col">
          <div className="min-h-0 flex-1">
            <CustomChart kind={m.type} labels={labels} series={series} format={format} />
          </div>
          {more && <p className="shrink-0 pt-1 text-[11px] text-text-faint">Based on the top 500 rows</p>}
        </div>
      );
    }
  }
}

/** F26 `custom` widget: data (worker or REST, as the viewer) → shape → one mark. */
export function CustomWidget({ w }: { w: Custom }) {
  const ref = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(ref);
  const live = DATASETS[w.spec.data.dataset].live;
  const target = followTarget(w.spec);
  return (
    <div
      ref={ref}
      className="h-full"
      data-testid="custom-widget"
      data-dataset={w.spec.data.dataset}
      data-mark={w.spec.mark.type}
      data-paused={live && !onScreen ? 'true' : undefined}
      data-target={target?.value}
    >
      {live ? <LiveCustom w={w} paused={!onScreen} /> : <RestCustom w={w} />}
    </div>
  );
}
