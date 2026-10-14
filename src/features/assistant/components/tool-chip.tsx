import { Check, LoaderCircle, X } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import type { ToolCall } from '../assistant-store.ts';

/** F17-R2: one tool call: a spinner while it runs, then a check or a cross. */
export function ToolChip({ tool }: { tool: ToolCall }) {
  const state = tool.ok === null ? 'running' : tool.ok ? 'ok' : 'failed';
  return (
    <li
      data-testid="tool-chip"
      data-state={state}
      title={tool.summary}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold',
        state === 'running' && 'border-accent/40 bg-accent-soft text-accent',
        state === 'ok' && 'border-tile-border bg-tile text-text-muted',
        state === 'failed' && 'border-danger/40 bg-tile text-danger',
      )}
    >
      {state === 'running' ? (
        <LoaderCircle className="size-3 shrink-0 animate-spin" aria-label="Running" />
      ) : state === 'ok' ? (
        <Check className="size-3 shrink-0 text-ok" aria-label="Done" />
      ) : (
        <X className="size-3 shrink-0" aria-label="Failed" />
      )}
      <span className="truncate">{tool.label}</span>
    </li>
  );
}
