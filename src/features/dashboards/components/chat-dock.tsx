import { useEffect, useRef, useState, type RefObject } from 'react';
import { PanelRightClose, Sparkles } from 'lucide-react';
import type { Dashboard, WidgetPreview } from '@shared/contract/dashboards.ts';
import {
  IDLE_DOCK,
  turnActivity,
  turnFailure,
  type DockState,
} from '@/features/assistant/chat-progress';
import { Composer } from '@/features/assistant/components/composer';
import { MessageList } from '@/features/assistant/components/message-list';
import {
  askToChangeText,
  WidgetPreviewCard,
} from '@/features/assistant/components/widget-preview-card';
import { useDashboardChat } from '@/features/assistant/use-dashboard-chat';
import {
  AddKeyNote,
  AssistantModelLabel,
  useAssistantStatus,
} from '@/features/settings/components/assistant-status';
import { Button } from '@/shared/ui/button';

/**
 * §8 / D-132: F20's dock around F19's dashboard chat. Remote changes go straight to the page
 * session; a one-shot `?ask=` prompt is sent once the thread is ready.
 */
export function ChatDock({
  dashboardId,
  version,
  ask,
  onAskConsumed,
  onDashboardChanged,
  onCollapse,
  onAddPreview,
  previewStatusRef,
  draggablePreviews = false,
  onActivity,
  stopRef,
  retryRef,
  busyBy = null,
  syncKey = 0,
}: {
  /** F27: bumped when someone else changed the dashboard; the thread is re-read (Undo states). */
  syncKey?: number;
  /** F27 (D-154): someone else's assistant turn is running on this dashboard (their name). */
  busyBy?: string | null;
  /** F23: filled with the chat's Stop (the empty-dashboard starter's composer uses it). */
  stopRef?: RefObject<(() => void) | null>;
  /** Filled with the chat's Retry (the empty canvas's failure card uses it). */
  retryRef?: RefObject<(() => void) | null>;
  /** F23: the running turn's state (the page shows the build skeletons from it). */
  onActivity?(a: DockState): void;
  dashboardId: string;
  version: () => number;
  ask?: string;
  onAskConsumed(): void;
  onDashboardChanged(d: Dashboard): void;
  /** Desktop only: collapse to the rail. */
  onCollapse?: () => void;
  /** D-135: "Add to dashboard" on a preview card (the page saves, then records the card state). */
  onAddPreview(p: WidgetPreview): Promise<void>;
  /** D-135: filled with the chat's card-state setter (the page's grid drop uses it). */
  previewStatusRef: RefObject<
    ((id: string, status: 'added' | 'discarded') => Promise<void>) | null
  >;
  /** Cards can be dragged onto the grid (desktop owners). */
  draggablePreviews?: boolean;
}) {
  const chat = useDashboardChat(dashboardId, {
    onDashboardChanged: (d) => onDashboardChanged(d),
  });
  const { state } = chat;
  const sent = useRef(false);
  const [draft, setDraft] = useState<{ text: string } | null>(null);
  const { setPreviewStatus } = chat;
  const assistantStatus = useAssistantStatus();

  useEffect(() => {
    previewStatusRef.current = setPreviewStatus;
    return () => {
      if (previewStatusRef.current === setPreviewStatus) previewStatusRef.current = null;
    };
  }, [previewStatusRef, setPreviewStatus]);

  const { stop } = chat;
  useEffect(() => {
    if (!stopRef) return;
    stopRef.current = stop;
    return () => {
      if (stopRef.current === stop) stopRef.current = null;
    };
  }, [stopRef, stop]);

  const { retry } = chat;
  useEffect(() => {
    if (!retryRef) return;
    retryRef.current = retry;
    return () => {
      if (retryRef.current === retry) retryRef.current = null;
    };
  }, [retryRef, retry]);

  const { reload } = chat;
  const synced = useRef(syncKey);
  useEffect(() => {
    if (syncKey === synced.current) return;
    synced.current = syncKey;
    reload();
  }, [syncKey, reload]);

  // F27: a prompt refused with chat_busy goes back into the composer.
  const [restored, setRestored] = useState<string | null>(null);
  if (state.restore !== restored) {
    setRestored(state.restore);
    if (state.restore) setDraft({ text: state.restore });
  }

  const { streaming, changing } = turnActivity(state.streaming, state.messages.at(-1));
  const othersAsking = !!busyBy && !state.streaming;
  const ready = state.status === 'ready';
  const count = state.messages.length;
  const failure = state.streaming ? null : turnFailure(state.messages.at(-1));
  const failMessage = failure?.message;
  const failRetryable = failure?.retryable;
  const failSetup = failure?.setup;
  useEffect(() => {
    const failure =
      failMessage === undefined
        ? null
        : { message: failMessage, retryable: !!failRetryable, setup: !!failSetup };
    onActivity?.({ streaming, changing, ready, messages: count, failure });
  }, [onActivity, streaming, changing, ready, count, failMessage, failRetryable, failSetup]);
  useEffect(() => () => onActivity?.(IDLE_DOCK), [onActivity]);

  // One send per `?ask=` value; cleared once consumed, so the F23 starter can ask again.
  useEffect(() => {
    if (!ask) {
      sent.current = false;
      return;
    }
    if (sent.current || state.status !== 'ready' || state.notConfigured || state.streaming) return;
    sent.current = true;
    chat.send(ask);
    onAskConsumed();
  }, [ask, state.status, state.notConfigured, state.streaming, chat, onAskConsumed]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="chat-dock">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-glass-border px-4">
        <Sparkles aria-hidden className="size-4 text-accent" />
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <h2 className="text-sm font-semibold">Ask FMS</h2>
          <AssistantModelLabel status={assistantStatus} />
        </div>
        {onCollapse && (
          <Button variant="ghost" size="icon-sm" aria-label="Collapse chat" onClick={onCollapse}>
            <PanelRightClose />
          </Button>
        )}
      </div>
      {state.notConfigured ? (
        <AddKeyNote status={assistantStatus} testId="chat-not-configured" />
      ) : state.status === 'error' ? (
        <p className="p-4 text-sm text-danger" role="alert">
          {state.error ?? "Couldn't load the chat."}
        </p>
      ) : (
        <>
          {state.messages.length === 0 && state.status === 'ready' && (
            <p className="px-4 pt-4 text-sm text-text-muted">
              Ask for widgets, e.g. “Add today's running vehicles by status”.
            </p>
          )}
          <MessageList
            messages={state.messages}
            onRetry={chat.retry}
            onStop={chat.stop}
            onNavigate={() => {}}
            onUndo={(c) => void chat.undo(c.id, version())}
            undoDisabled={state.streaming}
            undoing={state.undoing}
            renderPreview={(p) => (
              <WidgetPreviewCard
                preview={p}
                draggable={draggablePreviews}
                disabled={state.streaming}
                onAdd={onAddPreview}
                onAskChange={(x) => setDraft({ text: askToChangeText(x) })}
                onDiscard={(x) => void setPreviewStatus(x.id, 'discarded')}
              />
            )}
          />
          {othersAsking && (
            <p
              role="status"
              data-testid="chat-busy"
              className="flex items-center gap-2 px-4 pb-1 text-xs text-text-muted"
            >
              <Sparkles
                aria-hidden
                className="size-3 animate-pulse text-accent motion-reduce:animate-none"
              />
              {busyBy} is asking the assistant…
            </p>
          )}
          {state.notice && !othersAsking && (
            <p role="status" className="px-4 pb-1 text-xs text-text-muted">
              {state.notice}{' '}
              <button type="button" className="text-accent" onClick={chat.dismissNotice}>
                Dismiss
              </button>
            </p>
          )}
          <Composer
            streaming={state.streaming}
            disabled={state.status !== 'ready' || othersAsking}
            onSend={chat.send}
            onStop={chat.stop}
            placeholder="Ask FMS to add or change widgets…"
            autoFocus={false}
            draft={draft}
            suggestions="dashboard"
          />
        </>
      )}
    </div>
  );
}
