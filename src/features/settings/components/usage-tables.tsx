import type { UsageReport, UsageTotals, UsageTurn } from '@shared/contract/index.ts';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { formatIst } from '@/shared/lib/format-date';
import { cn } from '@/shared/lib/utils';
import {
  CHAT_LABELS,
  formatRate,
  formatTokens,
  formatUsd,
  providerName,
  tokensIn,
} from '../lib/usage-format';

export const card = 'min-w-0 rounded-tile border border-tile-border bg-tile p-4';
export const heading = 'mb-3 text-[11px] font-semibold tracking-[0.06em] text-text-muted uppercase';

/** One KPI tile (string value: tokens, %, USD). */
export function UsageTile({
  id,
  label,
  value,
  note,
}: {
  id: string;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <section
      data-testid={`usage-tile-${id}`}
      className="flex flex-col gap-1 rounded-[var(--radius-panel)] p-4 shadow-panel glass"
    >
      <h3 className="truncate text-[11px] font-semibold tracking-[0.06em] text-text-muted uppercase">
        {label}
      </h3>
      <p className="font-display text-2xl font-black tabular-nums" data-testid="tile-value">
        {value}
      </p>
      <p className="truncate text-[11px] text-text-faint">{note}</p>
    </section>
  );
}

const th =
  'px-2 py-2 text-[11px] font-semibold tracking-[0.08em] whitespace-nowrap text-text-muted uppercase';
const td = 'px-2 py-2 whitespace-nowrap tabular-nums';

const TOTAL_COLS: { label: string; cell: (t: UsageTotals) => string; wide?: boolean }[] = [
  { label: 'Turns', cell: (t) => formatTokens(t.turns) },
  { label: 'Tokens in', cell: (t) => formatTokens(tokensIn(t)) },
  { label: 'Tokens out', cell: (t) => formatTokens(t.outputTokens) },
  { label: 'Cache read', cell: (t) => formatTokens(t.cacheReadTokens), wide: true },
  { label: 'Cache write', cell: (t) => formatTokens(t.cacheWriteTokens), wide: true },
  { label: 'Cache hit', cell: (t) => formatRate(t.cacheHitRate) },
  { label: 'Est. cost', cell: (t) => formatUsd(t.costUsd) },
];

/** Rows of usage totals, each led by its own label cells. */
export function TotalsTable<R extends UsageTotals>({
  label,
  heads,
  rows,
  rowKey,
  lead,
  empty = 'No usage in this period.',
}: {
  label: string;
  heads: string[];
  rows: R[];
  rowKey: (r: R) => string;
  lead: (r: R) => ReactNode[];
  empty?: string;
}) {
  return (
    <section className={card} aria-label={label}>
      <h2 className={heading}>{label}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-glass-border">
                {heads.map((h) => (
                  <th key={h} scope="col" className={cn(th, 'text-left')}>
                    {h}
                  </th>
                ))}
                {TOTAL_COLS.map((c) => (
                  <th
                    key={c.label}
                    scope="col"
                    className={cn(th, 'text-right', c.wide && 'hidden md:table-cell')}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={rowKey(r)} className="border-b border-glass-border last:border-0">
                  {lead(r).map((cell, i) => (
                    <td key={i} className={cn(td, 'text-left')}>
                      {cell}
                    </td>
                  ))}
                  {TOTAL_COLS.map((c) => (
                    <td
                      key={c.label}
                      className={cn(td, 'text-right', c.wide && 'hidden md:table-cell')}
                    >
                      {c.cell(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Today / 7 days / 30 days side by side. */
export function SummaryTable({ summary }: { summary: UsageReport['summary'] }) {
  const cols = [
    { key: 'today', label: 'Today', t: summary.today },
    { key: 'd7', label: '7 days', t: summary.d7 },
    { key: 'd30', label: '30 days', t: summary.d30 },
  ];
  return (
    <section className={card} aria-label="Totals" data-testid="usage-summary">
      <h2 className={heading}>Totals (IST days)</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-glass-border">
              <th scope="col" className={cn(th, 'text-left')}>
                <span className="sr-only">Metric</span>
              </th>
              {cols.map((c) => (
                <th key={c.key} scope="col" className={cn(th, 'text-right')}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TOTAL_COLS.map((m) => (
              <tr key={m.label} className="border-b border-glass-border last:border-0">
                <th scope="row" className={cn(td, 'text-left font-normal text-text-muted')}>
                  {m.label}
                </th>
                {cols.map((c) => (
                  <td key={c.key} className={cn(td, 'text-right')}>
                    {m.cell(c.t)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TurnPlace({ turn }: { turn: UsageTurn }) {
  if (turn.dashboardId) {
    return (
      <Link
        to="/dashboards/$id"
        params={{ id: turn.dashboardId }}
        className="text-accent underline-offset-2 hover:underline"
      >
        {CHAT_LABELS[turn.chat]}
      </Link>
    );
  }
  return <span>{CHAT_LABELS[turn.chat]}</span>;
}

/** The most expensive runs of the range. */
export function TopTurns({
  turns,
  userName,
}: {
  turns: UsageTurn[];
  /** Admin view: a user column. */
  userName?: (userId: string) => string;
}) {
  return (
    <section className={card} aria-label="Most expensive turns" data-testid="usage-top-turns">
      <h2 className={heading}>Most expensive turns</h2>
      {turns.length === 0 ? (
        <p className="text-sm text-text-muted">No usage in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-glass-border">
                <th scope="col" className={cn(th, 'text-left')}>
                  When (IST)
                </th>
                {userName && (
                  <th scope="col" className={cn(th, 'text-left')}>
                    User
                  </th>
                )}
                <th scope="col" className={cn(th, 'text-left')}>
                  Chat
                </th>
                <th scope="col" className={cn(th, 'text-left')}>
                  Model
                </th>
                <th scope="col" className={cn(th, 'text-right')}>
                  Tokens in
                </th>
                <th scope="col" className={cn(th, 'text-right')}>
                  Tokens out
                </th>
                <th scope="col" className={cn(th, 'text-right')}>
                  Est. cost
                </th>
              </tr>
            </thead>
            <tbody>
              {turns.map((t) => (
                <tr key={t.id} className="border-b border-glass-border last:border-0">
                  <td className={td}>{formatIst(t.at)}</td>
                  {userName && <td className={td}>{userName(t.userId)}</td>}
                  <td className={td}>
                    <TurnPlace turn={t} />
                  </td>
                  <td className={cn(td, 'text-text-muted')}>
                    {providerName(t.provider)} · {t.model}
                  </td>
                  <td className={cn(td, 'text-right')}>{formatTokens(tokensIn(t))}</td>
                  <td className={cn(td, 'text-right')}>{formatTokens(t.outputTokens)}</td>
                  <td className={cn(td, 'text-right')}>{formatUsd(t.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
