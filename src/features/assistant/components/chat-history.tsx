import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, MoreHorizontal, Pencil, Search, Trash2, X } from 'lucide-react';
import { CHAT_THREAD_TITLE_MAX, type ChatThreadSummary } from '@shared/contract/chat-threads.ts';
import { formatRelativeTime } from '@/features/access/lib/access-format';
import { useNow } from '@/shared/hooks/use-now';
import { cn } from '@/shared/lib/utils';
import type { ChatHistory as History } from '../assistant-store.ts';

const iconButton =
  'grid size-7 shrink-0 place-items-center rounded-md text-text-muted outline-none hover:bg-tile hover:text-text focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5';
const textButton =
  'rounded-md px-2 py-1 text-xs font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * F28 §5: the Ask FMS history inside the panel: search by title, rows (title, preview, relative
 * time; the open thread highlighted), a row menu with inline Rename and Delete (with confirm),
 * "Load more" after 50 rows.
 */
export function ChatHistory({
  history,
  openId,
  onSearch,
  onOpen,
  onLoadMore,
  onRename,
  onDelete,
}: {
  history: History;
  openId: string | null;
  onSearch(q: string): void;
  onOpen(id: string): void;
  onLoadMore(): void;
  onRename(id: string, title: string): Promise<void>;
  onDelete(id: string): Promise<void>;
}) {
  const [q, setQ] = useState(history.q);
  const now = useNow(30_000);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const search = (value: string) => {
    setQ(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onSearch(value), 200);
  };

  const { items, status } = history;
  return (
    <div data-testid="chat-history" className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pt-3 pb-2">
        <label className="flex items-center gap-2 rounded-tile border border-tile-border bg-tile px-2.5 focus-within:ring-2 focus-within:ring-ring">
          <Search aria-hidden className="size-3.5 shrink-0 text-text-faint" />
          <input
            type="search"
            value={q}
            maxLength={60}
            onChange={(e) => search(e.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
            className="h-8 min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {status === 'error' && (
          <p role="alert" className="px-2 py-3 text-xs text-danger">
            {history.error ?? 'Could not load conversations'}
          </p>
        )}
        {status === 'ready' && items.length === 0 && (
          <p data-testid="chat-history-empty" className="px-2 py-6 text-center text-sm text-text-muted">
            {history.q.trim()
              ? 'No conversations match your search.'
              : 'No conversations yet. Ask anything about your fleet to start one.'}
          </p>
        )}
        <ul className="space-y-0.5">
          {items.map((t) => (
            <HistoryRow
              key={t.id}
              thread={t}
              open={t.id === openId}
              now={now}
              onOpen={() => onOpen(t.id)}
              onRename={(title) => onRename(t.id, title)}
              onDelete={() => onDelete(t.id)}
            />
          ))}
        </ul>
        {status === 'loading' && (
          <p className="flex items-center justify-center gap-2 py-3 text-xs text-text-muted">
            <Loader2 aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
            Loading…
          </p>
        )}
        {status === 'ready' && history.nextCursor && (
          <button
            type="button"
            data-testid="chat-history-more"
            onClick={onLoadMore}
            className={cn(textButton, 'mx-auto mt-2 block text-accent hover:bg-tile')}
          >
            Load more
          </button>
        )}
      </div>
    </div>
  );
}

function HistoryRow({
  thread,
  open,
  now,
  onOpen,
  onRename,
  onDelete,
}: {
  thread: ChatThreadSummary;
  open: boolean;
  now: number;
  onOpen(): void;
  onRename(title: string): Promise<void>;
  onDelete(): Promise<void>;
}) {
  const [mode, setMode] = useState<'view' | 'menu' | 'rename' | 'delete'>('view');
  const [title, setTitle] = useState(thread.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setMode('view');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const saveTitle = () => {
    const next = title.trim();
    if (!next || next === thread.title) return setMode('view');
    void act(() => onRename(next));
  };

  if (mode === 'rename')
    return (
      <li data-testid="chat-history-row" data-thread-id={thread.id} className="px-2 py-1.5">
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            saveTitle();
          }}
        >
          <input
            autoFocus
            value={title}
            maxLength={CHAT_THREAD_TITLE_MAX}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setTitle(thread.title);
                setMode('view');
              }
            }}
            aria-label="Conversation title"
            className="h-8 min-w-0 flex-1 rounded-md border border-tile-border bg-tile px-2 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button type="submit" disabled={busy} aria-label="Save title" className={iconButton}>
            <Check aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Cancel rename"
            onClick={() => {
              setTitle(thread.title);
              setMode('view');
            }}
            className={iconButton}
          >
            <X aria-hidden />
          </button>
        </form>
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </li>
    );

  if (mode === 'delete')
    return (
      <li
        data-testid="chat-history-row"
        data-thread-id={thread.id}
        className="rounded-tile border border-danger/30 bg-danger/10 px-3 py-2"
      >
        <p className="text-xs text-text">Delete this conversation? This can&apos;t be undone.</p>
        <div className="mt-1.5 flex justify-end gap-1">
          <button
            type="button"
            onClick={() => setMode('view')}
            className={cn(textButton, 'text-text-muted hover:bg-tile')}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            data-testid="chat-history-confirm-delete"
            onClick={() => void act(onDelete)}
            className={cn(textButton, 'text-danger hover:bg-danger/15')}
          >
            Delete
          </button>
        </div>
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </li>
    );

  return (
    <li
      data-testid="chat-history-row"
      data-thread-id={thread.id}
      data-open={open || undefined}
      className={cn(
        'group relative flex items-start gap-1 rounded-tile pr-1',
        open ? 'bg-accent-soft' : 'hover:bg-tile',
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-current={open || undefined}
        className="min-w-0 flex-1 rounded-tile px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-baseline gap-2">
          <span
            data-testid="chat-history-title"
            className="min-w-0 flex-1 truncate text-sm font-semibold text-text"
          >
            {thread.title}
          </span>
          <span className="shrink-0 text-[11px] text-text-faint tabular-nums">
            {formatRelativeTime(thread.updatedAt, now)}
          </span>
        </span>
        {thread.preview && (
          <span className="mt-0.5 block truncate text-xs text-text-muted">{thread.preview}</span>
        )}
        {thread.trimmed && (
          <span className="mt-0.5 block text-[11px] text-text-faint">
            Earlier messages were removed
          </span>
        )}
      </button>
      {mode === 'menu' ? (
        <div className="flex shrink-0 items-center gap-0.5 py-1.5">
          <button
            type="button"
            aria-label="Rename"
            title="Rename"
            onClick={() => setMode('rename')}
            className={iconButton}
          >
            <Pencil aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Delete"
            title="Delete"
            onClick={() => setMode('delete')}
            className={cn(iconButton, 'hover:text-danger')}
          >
            <Trash2 aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMode('view')}
            className={iconButton}
          >
            <X aria-hidden />
          </button>
        </div>
      ) : (
        <button
          type="button"
          aria-label={`More actions for ${thread.title}`}
          data-testid="chat-history-menu"
          onClick={() => setMode('menu')}
          className={cn(
            iconButton,
            'mt-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100',
          )}
        >
          <MoreHorizontal aria-hidden />
        </button>
      )}
    </li>
  );
}
