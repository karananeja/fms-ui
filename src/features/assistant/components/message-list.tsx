import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { RotateCcw } from 'lucide-react';
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
import { can, ROUTE_PERMISSIONS } from '@/features/access/permissions/can';
import { selectMe, useSession } from '@/features/auth/session/use-session';
import { cn } from '@/shared/lib/utils';
import { ERROR_TEXT, type ChatError, type ToolCall } from '../assistant-store.ts';
import { ChangeChip } from './change-chip.tsx';
import { DashboardLinkCard } from './dashboard-link-card.tsx';
import { Markdown, type RenderEntity } from './markdown.tsx';
import { ReportCard } from './report-card.tsx';
import { ToolChip } from './tool-chip.tsx';

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
  status?: 'streaming' | 'done' | 'stopped' | 'error';
  error?: ChatError | null;
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
}: {
  m: ChatViewMessage;
  last: boolean;
  renderEntity: RenderEntity;
  onRetry(): void;
  onNavigate(): void;
  undo: UndoProps;
  renderPreview?: (p: WidgetPreview) => ReactNode;
}) {
  const tools = m.tools ?? [];
  const status = m.status ?? 'done';
  const live = tools.length > 0;
  const thinking = status === 'streaming' && !m.text && tools.every((t) => t.ok !== null);
  const error = m.error ?? null;
  return (
    <div data-testid="assistant-message" data-status={status} className="space-y-2">
      {live ? (
        <ul aria-label="Tools used" className="flex flex-wrap gap-1.5">
          {tools.map((t) => (
            <ToolChip key={t.id} tool={t} />
          ))}
        </ul>
      ) : (
        (m.chips?.length ?? 0) > 0 && <StoredChips m={m} undo={undo} />
      )}
      {thinking && (
        <p className="animate-pulse text-xs text-text-muted" aria-live="polite">
          Thinking…
        </p>
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
      {status === 'stopped' && <p className="text-xs text-text-faint">Stopped.</p>}
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
          {ERROR_TEXT[error.code]}
        </div>
      )}
      {last && (status === 'error' || status === 'stopped') && error?.code !== 'refusal' && (
        <button
          type="button"
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
}: {
  messages: readonly ChatViewMessage[];
  onRetry(): void;
  onNavigate(): void;
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
          <div key={m.id} className="flex justify-end">
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
          />
        ),
      )}
    </div>
  );
}
