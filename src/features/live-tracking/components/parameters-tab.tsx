import { Search } from 'lucide-react';
import { memo } from 'react';
import { cn } from '@/shared/lib/utils';
import { detailsConfig, type ParameterGroupId } from '../config/details-config';
import type { Highlight, ParameterCell } from '../lib/vehicle-details-model';
import { Skeleton, StatTile } from './details-ui';

type RowProps = Pick<ParameterCell, 'label' | 'value' | 'na' | 'title'> & {
  pid: string;
  onRender?: (pid: string) => void;
};

/** One dense row; memoised per key so a changed PID re-renders only its row (F07-R14). */
const ParamRow = memo(function ParamRow({ pid, label, value, na, title, onRender }: RowProps) {
  onRender?.(pid);
  return (
    <div
      role="row"
      title={title}
      data-pid={pid}
      className="grid grid-cols-[1fr_auto] gap-3 border-b border-dashed border-tile-border px-0.5 py-[7px] text-xs"
    >
      <span role="cell" className="truncate text-text-muted uppercase">
        {label}
      </span>
      <span role="cell" className={cn('tabular-nums', na && 'text-text-faint')}>
        {value}
      </span>
    </div>
  );
});

export function ParametersTab({
  cells,
  total,
  highlights,
  query,
  setQuery,
  group,
  setGroup,
  onCellRender,
}: {
  cells: ParameterCell[] | null;
  total: number;
  highlights: Highlight[];
  query: string;
  setQuery: (q: string) => void;
  group: ParameterGroupId;
  setGroup: (g: ParameterGroupId) => void;
  onCellRender?: (pid: string) => void;
}) {
  return (
    <>
      <label className="flex h-[38px] items-center gap-2.5 rounded-[14px] px-3.5 text-xs text-text-muted glass">
        <Search className="size-3.5" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`SEARCH ${total} PARAMETERS`}
          aria-label="Search parameters"
          className="min-w-0 flex-1 bg-transparent text-text placeholder:text-text-muted focus:outline-none"
        />
      </label>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Parameter groups">
        {detailsConfig.parameterGroups.map((g) => (
          <button
            key={g.id}
            type="button"
            aria-pressed={group === g.id}
            onClick={() => setGroup(g.id)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11px] font-semibold',
              group === g.id
                ? 'border-accent/50 bg-accent-soft text-accent'
                : 'border-tile-border text-text-muted',
            )}
          >
            {g.label}
          </button>
        ))}
      </div>
      {highlights.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {highlights.map((h) => (
            <StatTile key={h.key} label={h.label} value={h.value} />
          ))}
        </div>
      )}
      {cells ? (
        <div role="table" aria-label="Parameters" data-testid="param-list">
          {cells.map((c) => (
            <ParamRow
              key={c.key}
              pid={c.key}
              label={c.label}
              value={c.value}
              na={c.na}
              title={c.title}
              onRender={onCellRender}
            />
          ))}
          {cells.length === 0 && (
            <p className="py-4 text-center text-xs text-text-muted">No matching parameters</p>
          )}
        </div>
      ) : (
        <Skeleton className="h-60" label="parameters" />
      )}
    </>
  );
}
