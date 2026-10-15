import { Download, FileText } from 'lucide-react';
import type { ReportDescriptor } from '@shared/contract/assistant.ts';
import { useNow } from '@/shared/hooks/use-now';
import { formatIst } from '@/shared/lib/format-date';
import { cn } from '@/shared/lib/utils';

const rowsText = (n: number) => `${n.toLocaleString('en-IN')} ${n === 1 ? 'row' : 'rows'}`;

/** F17-R4: a generated report: file name, rows, format and Download until the link expires. */
export function ReportCard({ report }: { report: ReportDescriptor }) {
  const now = useNow(15_000);
  const expired = now >= report.expiresAt;
  return (
    <div
      data-testid="report-card"
      data-expired={expired || undefined}
      className="flex items-center gap-3 rounded-tile border border-tile-border bg-tile p-3"
    >
      <FileText className="size-5 shrink-0 text-accent" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-text" title={report.filename}>
          {report.filename}
        </p>
        <p className="mt-0.5 flex items-center gap-2 text-[11px] text-text-muted">
          <span
            className={cn(
              'rounded px-1.5 py-px text-[10px] font-semibold tracking-wider uppercase',
              report.format === 'pdf' ? 'bg-danger/15 text-danger' : 'bg-accent-soft text-accent',
            )}
          >
            {report.format}
          </span>
          <span data-testid="report-rows">{rowsText(report.rows)}</span>
        </p>
        {expired ? (
          <p className="mt-1 text-[11px] text-warn">Link expired — ask again to regenerate</p>
        ) : (
          <p className="mt-1 text-[11px] text-text-faint">
            Link valid until {formatIst(report.expiresAt)}
          </p>
        )}
      </div>
      {!expired && (
        <a
          href={report.url}
          download={report.filename}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-tile-border bg-tile px-3 text-xs font-bold outline-none hover:bg-accent-soft hover:text-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Download className="size-3.5" aria-hidden />
          Download
        </a>
      )}
    </div>
  );
}
