import { useEffect, useRef } from 'react';
import { Link } from '@tanstack/react-router';
import { RotateCcw } from 'lucide-react';
import type { EntityRef } from '@shared/contract/assistant.ts';
import { can, ROUTE_PERMISSIONS } from '@/features/access/permissions/can';
import { selectMe, useSession } from '@/features/auth/session/use-session';
import { cn } from '@/shared/lib/utils';
import { ERROR_TEXT, type AssistantMessage, type Message } from '../assistant-store.ts';
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

function Answer({
  m,
  last,
  renderEntity,
  onRetry,
}: {
  m: AssistantMessage;
  last: boolean;
  renderEntity: RenderEntity;
  onRetry(): void;
}) {
  const thinking = m.status === 'streaming' && !m.text && m.tools.every((t) => t.ok !== null);
  const error = m.error;
  return (
    <div data-testid="assistant-message" data-status={m.status} className="space-y-2">
      {m.tools.length > 0 && (
        <ul aria-label="Tools used" className="flex flex-wrap gap-1.5">
          {m.tools.map((t) => (
            <ToolChip key={t.id} tool={t} />
          ))}
        </ul>
      )}
      {thinking && (
        <p className="animate-pulse text-xs text-text-muted" aria-live="polite">
          Thinking…
        </p>
      )}
      {m.text && (
        <div className="text-sm leading-relaxed text-text">
          <Markdown text={m.text} entities={m.entities} renderEntity={renderEntity} />
        </div>
      )}
      {m.reports.map((r) => (
        <ReportCard key={r.id} report={r} />
      ))}
      {m.status === 'stopped' && <p className="text-xs text-text-faint">Stopped.</p>}
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
      {last && (m.status === 'error' || m.status === 'stopped') && error?.code !== 'refusal' && (
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
}: {
  messages: readonly Message[];
  onRetry(): void;
  onNavigate(): void;
}) {
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
          />
        ),
      )}
    </div>
  );
}
