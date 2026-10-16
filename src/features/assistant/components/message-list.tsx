import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Check, Copy, Loader2, RotateCcw, Unplug } from 'lucide-react';
import {
  isDashboardMutatingTool,
  type DashboardLink,
  type EntityRef,
  type ReportDescriptor,
} from '@shared/contract/assistant.ts';
import type {
  ChangeSet,
  ToolChip as StoredChip,
  WidgetPreview,
} from '@shared/contract/dashboards.ts';
import type { ActionCard as ActionCardData } from '@shared/contract/actions.ts';
import { can, ROUTE_PERMISSIONS } from '@/features/access/permissions/can';
import { LiveActionCard } from '@/features/activity/components/action-card';
import { selectMe, useSession } from '@/features/auth/session/use-session';
import { cn } from '@/shared/lib/utils';
import { ERROR_TEXT, type ChatError, type ToolCall } from '../assistant-store.ts';
import { formatElapsed, progressLabel } from '../chat-progress.ts';
import { ChangeChip } from './change-chip.tsx';
import { DashboardLinkCard } from './dashboard-link-card.tsx';
import { Markdown, type RenderEntity } from './markdown.tsx';
import { ReportCard } from './report-card.tsx';
import { ToolChip } from './tool-chip.tsx';

/** Copies a sent prompt (shown on hover / focus; always on touch screens). */
function CopyPrompt({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      data-testid="copy-prompt"
      aria-label={copied ? 'Copied' : 'Copy message'}
      onClick={() =>
        void navigator.clipboard.writeText(text).then(
          () => setCopied(true),
          () => {},
        )
      }
      className="mt-1 grid size-7 shrink-0 place-items-center rounded-md text-text-faint opacity-0 outline-none group-hover:opacity-100 hover:bg-tile hover:text-text focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5 [@media(hover:none)]:opacity-100"
    >
      {copied ? <Check aria-hidden className="text-accent" /> : <Copy aria-hidden />}
    </button>
  );
}

const linkClass =
  'font-bold text-accent underline decoration-accent/40 underline-offset-2 outline-none hover:decoration-accent focus-visible:ring-2 focus-visible:ring-ring rounded-sm';

/** F17-R3: vehicles open on the map, drivers in the analytics drill-down (when allowed). */
function useEntityRenderer(onNavigate: () => void): RenderEntity {
  const me = useSession(selectMe);
  const map = can(me, ROUTE_PERMISSIONS['/live-tracking']);
  const analytics = can(me, ROUTE_PERMISSIONS['/analytics']);
  return (ref: EntityRef, text: string, key: string) => {
    if (ref.kind === 'vehicle' && map)
      return (
        <Link
          key={key}
          to="/live-tracking"
          search={{ vehicle: ref.id }}
          onClick={onNavigate}
          data-testid="entity-link"
          data-kind="vehicle"
          className={linkClass}
        >
          {text}
        </Link>
      );
    if (ref.kind === 'driver' && analytics)
      return (
        <Link
          key={key}
          to="/analytics"
          search={{ tab: 'drivers', driver: ref.id }}
          onClick={onNavigate}
          data-testid="entity-link"
          data-kind="driver"
          className={linkClass}
        >
          {text}
        </Link>
      );
    return <span key={key}>{text}</span>;
  };
}

/**
 * A message as the list shows it: F17 global answers and F19 dashboard-chat messages
 * (stored `chips` + `change`) both fit.
 */
export interface ChatViewMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  tools?: readonly ToolCall[];
  reports?: readonly ReportDescriptor[];
  entities?: readonly EntityRef[];
  dashboards?: readonly DashboardLink[];
  chips?: readonly StoredChip[];
  change?: ChangeSet | null;
  previews?: readonly WidgetPreview[];
  /** F29: proposed actions (Confirm / Cancel / Undo). */
  actions?: readonly ActionCardData[];
  status?: 'streaming' | 'done' | 'stopped' | 'error' | 'interrupted';
  error?: ChatError | null;
}

/** F23: the progress row of a streaming answer: spinner, current step, elapsed time, Cancel. */
function ProgressRow({ label, onStop }: { label: string; onStop?: () => void }) {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div
      data-testid="chat-progress"
      role="status"
      className="flex items-center gap-2 rounded-tile border border-tile-border bg-tile px-2.5 py-1.5 text-xs text-text-muted"
    >
      <Loader2
        aria-hidden
        className="size-3.5 shrink-0 animate-spin text-accent motion-reduce:animate-none"
      />
      <span data-testid="chat-progress-label" className="min-w-0 flex-1 truncate">
        {label}
      </span>
      <span data-testid="chat-progress-elapsed" className="shrink-0 text-text-faint tabular-nums">
        {formatElapsed(now - start)}
      </span>
      {onStop && (
        <button
          type="button"
          onClick={onStop}
          data-testid="progress-stop"
          className="shrink-0 rounded-md px-1.5 py-0.5 font-bold text-accent outline-none hover:bg-surface-solid focus-visible:ring-2 focus-visible:ring-ring"
        >
          Cancel
        </button>
      )}
    </div>
  );
}

/** F19 Undo wiring (dashboard chat only). */
export interface UndoProps {
  onUndo?(change: ChangeSet): void;
  /** Hide Undo (e.g. while a reply streams). */
  undoDisabled?: boolean;
  /** The change id whose Undo is in flight. */
  undoing?: string | null;
}

/** Stored chips: change chips (with Undo on the turn's last change) and read-only tool chips. */
function StoredChips({ m, undo }: { m: ChatViewMessage; undo: UndoProps }) {
  const chips = m.chips ?? [];
  let lastChange = -1;
  chips.forEach((c, i) => {
    if (c.status === 'ok' && isDashboardMutatingTool(c.tool)) lastChange = i;
  });
  const change = m.change ?? null;
  return (
    <ul aria-label="Tools used" className="flex flex-wrap gap-1.5">
      {chips.map((c, i) =>
        isDashboardMutatingTool(c.tool) ? (
          <ChangeChip
            key={i}
            chip={c}
            change={change}
            showUndo={i === lastChange && !undo.undoDisabled && m.status !== 'streaming'}
            undoing={!!change && undo.undoing === change.id}
            onUndo={change && undo.onUndo ? () => undo.onUndo!(change) : undefined}
          />
        ) : (
          <ToolChip
            key={i}
            tool={{ id: String(i), name: c.tool, label: c.label, ok: c.status === 'ok' }}
          />
        ),
      )}
    </ul>
  );
}

function Answer({
  m,
  last,
  renderEntity,
  onRetry,
  onNavigate,
  undo,
  renderPreview,
  onStop,
}: {
  m: ChatViewMessage;
  last: boolean;
  renderEntity: RenderEntity;
  onRetry(): void;
  onNavigate(): void;
  undo: UndoProps;
  renderPreview?: (p: WidgetPreview) => ReactNode;
  onStop?: () => void;
}) {
  const tools = m.tools ?? [];
  const status = m.status ?? 'done';
  const live = tools.length > 0;
  const error = m.error ?? null;
  const changed = (m.chips?.length ?? 0) > 0 || !!m.change;
  return (
    <div
      data-testid="assistant-message"
      data-status={status}
      data-change-id={m.change?.id}
      className="space-y-2"
    >
      {live ? (
        <ul aria-label="Tools used" className="flex flex-wrap gap-1.5">
          {tools.map((t) => (
            <ToolChip key={t.id} tool={t} />
          ))}
        </ul>
      ) : (
        (m.chips?.length ?? 0) > 0 && <StoredChips m={m} undo={undo} />
      )}
      {m.text && (
        <div className="text-sm leading-relaxed text-text">
          <Markdown text={m.text} entities={m.entities ?? []} renderEntity={renderEntity} />
        </div>
      )}
      {(m.reports ?? []).map((r) => (
        <ReportCard key={r.id} report={r} />
      ))}
      {(m.dashboards ?? []).map((d) => (
        <DashboardLinkCard key={d.summary.id} link={d} onNavigate={onNavigate} />
      ))}
      {renderPreview && (m.previews ?? []).map((p) => <div key={p.id}>{renderPreview(p)}</div>)}
      {(m.actions ?? []).map((a) => (
        <LiveActionCard key={a.id} initial={a} />
      ))}
      {status === 'streaming' && <ProgressRow label={progressLabel(m)} onStop={onStop} />}
      {status === 'stopped' && <p className="text-xs text-text-faint">Stopped.</p>}
      {status === 'interrupted' && (
        <div
          data-testid="assistant-interrupted"
          className="flex items-start gap-2 rounded-tile border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-text"
        >
          <Unplug aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warn" />
          <p>
            <span className="font-semibold">Interrupted.</span> The connection dropped before the
            answer finished{m.text ? '; the partial answer is kept above' : ''}.
            {changed && ' Changes it already made are listed above and can still be undone.'}
          </p>
        </div>
      )}
      {error && (
        <div
          role={error.code === 'refusal' ? undefined : 'alert'}
          data-testid="assistant-error"
          data-code={error.code}
          className={cn(
            'rounded-tile border px-3 py-2 text-sm',
            error.code === 'refusal'
              ? 'border-tile-border bg-tile text-text'
              : 'border-danger/30 bg-danger/10 text-text',
          )}
        >
          {/* `failed` covers many causes; the server's message names this one (e.g. no credits). */}
          {error.code === 'failed' && error.message ? error.message : ERROR_TEXT[error.code]}
        </div>
      )}
      {last &&
        (status === 'error' || status === 'stopped' || status === 'interrupted') &&
        error?.code !== 'refusal' && (
          <button
            type="button"
            data-testid="assistant-retry"
            onClick={onRetry}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-bold text-accent outline-none hover:bg-tile focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            Retry
          </button>
        )}
    </div>
  );
}

/** The conversation, newest at the bottom; follows the stream while you're near the end. */
export function MessageList({
  messages,
  onRetry,
  onNavigate,
  onUndo,
  undoDisabled,
  undoing,
  renderPreview,
  onStop,
}: {
  messages: readonly ChatViewMessage[];
  onRetry(): void;
  onNavigate(): void;
  /** F23: Cancel in the progress row of a streaming answer. */
  onStop?: () => void;
  /** D-135: the host's preview card (its actions differ per chat). */
  renderPreview?: (p: WidgetPreview) => ReactNode;
} & UndoProps) {
  const undo: UndoProps = { onUndo, undoDisabled, undoing };
  const renderEntity = useEntityRenderer(onNavigate);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div
      ref={scroller}
      data-testid="assistant-messages"
      aria-live="polite"
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 48;
      }}
      className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4"
    >
      {messages.map((m, i) =>
        m.role === 'user' ? (
          <div key={m.id} className="group flex items-start justify-end gap-1">
            <CopyPrompt text={m.text} />
            <p
              data-testid="user-message"
              className="max-w-[85%] rounded-tile rounded-br-sm bg-accent-soft px-3 py-2 text-sm whitespace-pre-wrap text-text"
            >
              {m.text}
            </p>
          </div>
        ) : (
          <Answer
            key={m.id}
            m={m}
            last={i === messages.length - 1}
            renderEntity={renderEntity}
            onRetry={onRetry}
            onNavigate={onNavigate}
            undo={undo}
            renderPreview={renderPreview}
            onStop={onStop}
          />
        ),
      )}
    </div>
  );
}
