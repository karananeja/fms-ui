import { useEffect, useRef, useState, type RefObject } from 'react';
import { PanelRightClose, Sparkles } from 'lucide-react';
import type { Dashboard, WidgetPreview } from '@shared/contract/dashboards.ts';
import { Composer } from '@/features/assistant/components/composer';
import { MessageList } from '@/features/assistant/components/message-list';
import {
  askToChangeText,
  WidgetPreviewCard,
} from '@/features/assistant/components/widget-preview-card';
import { useDashboardChat } from '@/features/assistant/use-dashboard-chat';
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
}: {
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

  useEffect(() => {
    previewStatusRef.current = setPreviewStatus;
    return () => {
      if (previewStatusRef.current === setPreviewStatus) previewStatusRef.current = null;
    };
  }, [previewStatusRef, setPreviewStatus]);

  useEffect(() => {
    if (!ask || sent.current || state.status !== 'ready' || state.notConfigured) return;
    sent.current = true;
    chat.send(ask);
    onAskConsumed();
  }, [ask, state.status, state.notConfigured, chat, onAskConsumed]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="chat-dock">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-glass-border px-4">
        <Sparkles aria-hidden className="size-4 text-accent" />
        <h2 className="flex-1 text-sm font-semibold">Ask FMS</h2>
        {onCollapse && (
          <Button variant="ghost" size="icon-sm" aria-label="Collapse chat" onClick={onCollapse}>
            <PanelRightClose />
          </Button>
        )}
      </div>
      {state.notConfigured ? (
        <p className="p-4 text-sm text-text-muted" data-testid="chat-not-configured">
          The assistant isn't configured on this server yet.
        </p>
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
          {state.notice && (
            <p role="status" className="px-4 pb-1 text-xs text-text-muted">
              {state.notice}{' '}
              <button type="button" className="text-accent" onClick={chat.dismissNotice}>
                Dismiss
              </button>
            </p>
          )}
          <Composer
            streaming={state.streaming}
            disabled={state.status !== 'ready'}
            onSend={chat.send}
            onStop={chat.stop}
            placeholder="Ask FMS to add or change widgets…"
            autoFocus={false}
            draft={draft}
          />
        </>
      )}
    </div>
  );
}
