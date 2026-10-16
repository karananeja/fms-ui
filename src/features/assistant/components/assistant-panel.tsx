import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight, History, Loader2, MessageSquarePlus, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { WidgetPreview } from '@shared/contract/dashboards.ts';
import { useCan } from '@/features/access/permissions/can';
import {
  AddKeyNote,
  ModelPicker,
  useAssistantStatus,
} from '@/features/settings/components/assistant-status';
import { cn } from '@/shared/lib/utils';
import { SUGGESTED_PROMPTS } from '../assistant-store.ts';
import { useAssistant, useAssistantStore } from '../use-assistant.ts';
import { AddToDashboardPicker } from './add-to-dashboard-picker.tsx';
import { ChatHistory } from './chat-history.tsx';
import { Composer } from './composer.tsx';
import { MessageList } from './message-list.tsx';
import { askToChangeText, WidgetPreviewCard } from './widget-preview-card.tsx';

const headerButton =
  'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-bold text-accent outline-none hover:bg-tile focus-visible:ring-2 focus-visible:ring-ring';

/**
 * F17-R1…R6 / F28 §5: the assistant sheet's contents (lazy chunk): suggested prompts when empty,
 * the conversation and the composer; New chat and History (saved conversations) in the header.
 * All behaviour is in `AssistantStore`.
 */
export function AssistantPanel({ onClose }: { onClose(): void }) {
  const store = useAssistantStore();
  const state = useAssistant((s) => s);
  const empty = state.messages.length === 0;
  const canDashboards = useCan('dashboards.use');
  const [draft, setDraft] = useState<{ text: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const assistantStatus = useAssistantStatus();

  // F28 (D-164): the tab's last thread, else a recent one, else a new chat.
  useEffect(() => {
    void store.open();
  }, [store]);

  // F28: a prompt refused with `chat_busy` goes back into the box.
  const [restored, setRestored] = useState<string | null>(null);
  if (state.restore !== restored) {
    setRestored(state.restore);
    if (state.restore) setDraft({ text: state.restore });
  }

  const openHistory = () => {
    setShowHistory(true);
    void store.loadHistory('');
  };

  // D-135: global preview cards; their state is local to this browser.
  const renderPreview = (p: WidgetPreview) => (
    <WidgetPreviewCard
      preview={p}
      addControl={
        canDashboards ? (
          <AddToDashboardPicker
            preview={p}
            onAdded={(d) => store.setPreviewStatus(p.id, 'added', d.id)}
          />
        ) : (
          <></>
        )
      }
      addedExtra={
        p.dashboardId && (
          <Link
            to="/dashboards/$id"
            params={{ id: p.dashboardId }}
            onClick={onClose}
            data-testid="preview-open-dashboard"
            className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-bold text-accent outline-none hover:bg-tile focus-visible:ring-2 focus-visible:ring-ring"
          >
            Open dashboard
            <ArrowRight className="size-3" aria-hidden />
          </Link>
        )
      }
      onAskChange={(x) => setDraft({ text: askToChangeText(x) })}
      onDiscard={(x) => store.setPreviewStatus(x.id, 'discarded')}
    />
  );

  return (
    <div data-testid="assistant-panel" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-glass-border px-4 pt-3.5 pr-12 pb-2.5">
        {showHistory ? (
          <>
            <button
              type="button"
              aria-label="Back to the conversation"
              onClick={() => setShowHistory(false)}
              className="-ml-1 grid size-7 place-items-center rounded-md text-text-muted outline-none hover:bg-tile hover:text-text focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft className="size-4" aria-hidden />
            </button>
            <h2 className="text-xs font-semibold tracking-[0.06em] text-text uppercase">
              History
            </h2>
          </>
        ) : (
          <>
            <Sparkles className="size-4 shrink-0 text-accent" aria-hidden />
            <h2 className="shrink-0 text-xs font-semibold tracking-[0.06em] text-text uppercase">
              Ask FMS
            </h2>
            <ModelPicker
              assistant={assistantStatus}
              disabled={state.streaming}
              onNavigate={onClose}
            />
          </>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => {
              store.clear();
              setShowHistory(false);
            }}
            className={headerButton}
          >
            <MessageSquarePlus className="size-3.5" aria-hidden />
            New chat
          </button>
          {!showHistory && (
            <button
              type="button"
              onClick={openHistory}
              data-testid="assistant-history"
              className={headerButton}
            >
              <History className="size-3.5" aria-hidden />
              History
            </button>
          )}
        </div>
      </div>

      {showHistory ? (
        <ChatHistory
          history={state.history}
          openId={state.threadId}
          onSearch={(q) => void store.loadHistory(q)}
          onOpen={(id) => {
            setShowHistory(false);
            void store.load(id);
          }}
          onLoadMore={() => void store.loadMore()}
          onRename={(id, title) => store.rename(id, title)}
          onDelete={async (id) => {
            if (await store.remove(id)) toast('Conversation deleted');
          }}
        />
      ) : (
        <>
          {state.title && !empty && (
            <p
              data-testid="assistant-thread-title"
              className="truncate border-b border-glass-border px-4 py-1.5 text-xs text-text-muted"
              title={state.title}
            >
              {state.title}
            </p>
          )}
          {state.notConfigured ? (
            <div className="mb-auto">
              <AddKeyNote
                status={assistantStatus.status}
                onNavigate={onClose}
                testId="assistant-not-configured"
              />
            </div>
          ) : state.loading && empty ? (
            <p className="flex flex-1 items-center justify-center gap-2 text-xs text-text-muted">
              <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
              Opening conversation…
            </p>
          ) : empty ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
              <p className="text-sm text-text">Ask about your fleet in plain English.</p>
              <p className="mt-1 text-xs text-text-muted">
                Answers use only the vehicles, drivers and requests you can see.
              </p>
              <p className="mt-5 mb-2 text-[11px] font-semibold tracking-[0.06em] text-text-faint uppercase">
                Try asking
              </p>
              <ul className="space-y-2">
                {SUGGESTED_PROMPTS.map((p) => (
                  <li key={p}>
                    <button
                      type="button"
                      data-testid="suggested-prompt"
                      onClick={() => store.send(p)}
                      className="w-full rounded-tile border border-tile-border bg-tile px-3 py-2.5 text-left text-sm text-text outline-none hover:border-accent/40 hover:bg-accent-soft focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {p}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className={cn('flex min-h-0 flex-1 flex-col', state.loading && 'opacity-60')}>
              <MessageList
                messages={state.messages}
                onRetry={() => store.retry()}
                onStop={() => store.stop()}
                onNavigate={onClose}
                renderPreview={renderPreview}
              />
            </div>
          )}

          {state.notice && (
            <p role="status" data-testid="assistant-notice" className="px-4 pb-1 text-xs text-text-muted">
              {state.notice}{' '}
              <button type="button" className="text-accent" onClick={() => store.dismissNotice()}>
                Dismiss
              </button>
            </p>
          )}
          <Composer
            streaming={state.streaming}
            disabled={state.notConfigured || state.loading}
            onSend={(t) => store.send(t)}
            onStop={() => store.stop()}
            draft={draft}
            suggestions="global"
          />
        </>
      )}
    </div>
  );
}
