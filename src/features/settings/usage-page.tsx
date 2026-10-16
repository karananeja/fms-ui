import { USAGE_RANGES, type UsageRange, type UsageReport } from '@shared/contract/index.ts';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { AdminLayout } from '@/features/access/components/admin-layout';
import { LoadError, Segmented, SelectField } from '@/features/access/components/admin-ui';
import { errorText } from '@/features/access/lib/access-format';
import { useResource } from '@/features/access/lib/use-resource';
import { useCan } from '@/features/access/permissions/can';
import { DayChart } from '@/features/analytics/components/day-chart';
import { downloadCsv } from '@/features/analytics/lib/analytics-model';
import { Button } from '@/shared/ui/button';
import { fetchUsageCsv, getMyUsage, getOrgUsage, type OrgUsageFilter } from './api/usage-api';
import { card, SummaryTable, TopTurns, TotalsTable, UsageTile } from './components/usage-tables';
import {
  CHAT_LABELS,
  formatRate,
  formatTokens,
  formatUsd,
  providerName,
  tokensIn,
} from './lib/usage-format';

const RANGE_OPTIONS = USAGE_RANGES.map((r) => ({ value: r, label: `${r.replace('d', '')} days` }));

type View = 'mine' | 'org';

/**
 * F30 Settings → AI usage (route `/settings/usage`, `chat.use`): the caller's token usage and
 * estimated cost; with `roles.manage`, an Organisation tab with every user, filters and CSV.
 */
export function UsagePage() {
  const isAdmin = useCan('roles.manage');
  const [view, setView] = useState<View>('mine');
  const [range, setRange] = useState<UsageRange>('30d');
  const org = isAdmin && view === 'org';

  return (
    <AdminLayout
      title="AI usage"
      description="Tokens used by the assistant and an estimated cost. Costs are estimates, not a bill."
    >
      <div className="flex flex-wrap items-center gap-3">
        {isAdmin && (
          <Segmented
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: 'mine', label: 'My usage' },
              { value: 'org', label: 'Organisation' },
            ]}
          />
        )}
        <Segmented label="Range" value={range} onChange={setRange} options={RANGE_OPTIONS} />
      </div>
      {org ? <OrgUsage range={range} /> : <MyUsage range={range} />}
    </AdminLayout>
  );
}

function MyUsage({ range }: { range: UsageRange }) {
  const res = useResource((signal) => getMyUsage(range, { signal }), range);
  if (res.error) return <LoadError message={errorText(res.error)} onRetry={res.reload} />;
  if (!res.data) return <p className="text-sm text-text-muted">Loading…</p>;
  return <UsageReportView report={res.data} />;
}

function OrgUsage({ range }: { range: UsageRange }) {
  const [userId, setUserId] = useState('');
  const [provider, setProvider] = useState('');
  const [users, setUsers] = useState<{ value: string; label: string }[]>([]);
  const [providers, setProviders] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const filter: OrgUsageFilter = {
    range,
    userId: userId || undefined,
    provider: provider || undefined,
  };
  const res = useResource(
    (signal) =>
      getOrgUsage(filter, { signal }).then((r) => {
        // Filter options come from an unfiltered load and are kept while filtering.
        if (!userId && r.byUser)
          setUsers(r.byUser.map((u) => ({ value: u.userId, label: u.name })));
        if (!provider) setProviders([...new Set(r.byModel.map((m) => m.provider))]);
        return r;
      }),
    `${range}|${userId}|${provider}`,
  );

  const exportCsv = async () => {
    setExporting(true);
    try {
      downloadCsv(`ai-usage-${range}.csv`, await fetchUsageCsv(filter));
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setExporting(false);
    }
  };

  const names = new Map(res.data?.byUser?.map((u) => [u.userId, u.name]));
  for (const u of users) if (!names.has(u.value)) names.set(u.value, u.label);

  return (
    <>
      {/* The fields' own bottom margin is dropped so they line up with the button (all 40 px). */}
      <div className="flex flex-wrap items-end gap-3 [&>div>div]:mb-0">
        <div className="w-56">
          <SelectField
            id="usage-user"
            label="User"
            value={userId}
            onChange={setUserId}
            options={[{ value: '', label: 'All users' }, ...users]}
          />
        </div>
        <div className="w-44">
          <SelectField
            id="usage-provider"
            label="Provider"
            value={provider}
            onChange={setProvider}
            options={[
              { value: '', label: 'All providers' },
              ...providers.map((p) => ({ value: p, label: providerName(p) })),
            ]}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void exportCsv()}
          disabled={exporting}
          data-testid="usage-export"
          className="h-10"
        >
          <Download className="size-4" aria-hidden />
          {exporting ? 'Exporting…' : 'Export CSV'}
        </Button>
      </div>
      {res.error ? (
        <LoadError message={errorText(res.error)} onRetry={res.reload} />
      ) : !res.data ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : (
        <UsageReportView report={res.data} userName={(id) => names.get(id) ?? id} />
      )}
    </>
  );
}

function UsageReportView({
  report,
  userName,
}: {
  report: UsageReport;
  userName?: (userId: string) => string;
}) {
  const t = report.totals;
  const unpriced = t.unpricedTurns > 0;
  const days = report.daily.map((d) => d.day);
  return (
    <div className="flex flex-col gap-4" data-testid="usage-report">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="usage-tiles">
        <UsageTile
          id="in"
          label="Tokens in"
          value={formatTokens(tokensIn(t))}
          note={`${formatTokens(t.cacheReadTokens)} read from cache`}
        />
        <UsageTile
          id="out"
          label="Tokens out"
          value={formatTokens(t.outputTokens)}
          note={`${formatTokens(t.turns)} turns`}
        />
        <UsageTile
          id="cache"
          label="Cache hit rate"
          value={formatRate(t.cacheHitRate)}
          note="of input tokens read from cache"
        />
        <UsageTile
          id="cost"
          label="Est. cost (estimate)"
          value={formatUsd(t.costUsd)}
          note={unpriced ? `USD · ${t.unpricedTurns} turns tokens only*` : 'USD · estimate'}
        />
      </div>
      {t.turns === 0 && (
        <p className="text-sm text-text-muted" data-testid="usage-empty">
          No assistant usage in this period yet.
        </p>
      )}
      <div className={card}>
        <DayChart
          title="Daily tokens"
          kind="stacked-bars"
          unit="tokens"
          days={days}
          series={[
            {
              label: 'Input',
              color: 'var(--accent)',
              values: report.daily.map((d) => d.inputTokens),
            },
            {
              label: 'Cache read',
              color: 'var(--st-immobilized)',
              values: report.daily.map((d) => d.cacheReadTokens),
            },
            {
              label: 'Cache write',
              color: 'var(--warn)',
              values: report.daily.map((d) => d.cacheWriteTokens),
            },
            {
              label: 'Output',
              color: 'var(--accent-2)',
              values: report.daily.map((d) => d.outputTokens),
            },
          ]}
        />
      </div>
      <SummaryTable summary={report.summary} />
      {report.byUser && (
        <TotalsTable
          label="By user"
          heads={['User']}
          rows={report.byUser}
          rowKey={(r) => r.userId}
          lead={(r) => [
            <span key="u" title={r.email}>
              {r.name}
            </span>,
          ]}
        />
      )}
      <TotalsTable
        label="By provider and model"
        heads={['Provider', 'Model']}
        rows={report.byModel}
        rowKey={(r) => `${r.provider}/${r.model}`}
        lead={(r) => [providerName(r.provider), r.priced ? r.model : `${r.model} *`]}
      />
      <TotalsTable
        label="By chat"
        heads={['Chat']}
        rows={report.byChat}
        rowKey={(r) => r.chat}
        lead={(r) => [CHAT_LABELS[r.chat]]}
      />
      <TopTurns turns={report.topTurns} userName={userName} />
      <p className="text-xs text-text-faint" data-testid="usage-footnote">
        Costs are estimates from list prices checked on {report.pricesChecked}, in USD.
        {(unpriced || report.byModel.some((m) => !m.priced)) &&
          ' * tokens only: no price on file for this model.'}
      </p>
    </div>
  );
}
