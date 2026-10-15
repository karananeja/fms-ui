import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowRight, MessageSquarePlus, Sparkles } from 'lucide-react';
import type { WidgetPreview } from '@shared/contract/dashboards.ts';
import { useCan } from '@/features/access/permissions/can';
import { SUGGESTED_PROMPTS } from '../assistant-store.ts';
import { useAssistant, useAssistantStore } from '../use-assistant.ts';
import { AddToDashboardPicker } from './add-to-dashboard-picker.tsx';
import { Composer } from './composer.tsx';
import { MessageList } from './message-list.tsx';
import { askToChangeText, WidgetPreviewCard } from './widget-preview-card.tsx';

/**
 * F17-R1…R6: the assistant sheet's contents (lazy chunk): suggested prompts when empty, the
 * conversation and the composer. All behaviour is in `AssistantStore`.
 */
export function AssistantPanel({ onClose }: { onClose(): void }) {
  const store = useAssistantStore();
  const state = useAssistant((s) => s);
  const empty = state.messages.length === 0;
  const canDashboards = useCan('dashboards.use');
  const [draft, setDraft] = useState<{ text: string } | null>(null);

  // D-135: global previews live for the panel session only (no server thread).
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
        <Sparkles className="size-4 text-accent" aria-hidden />
        <h2 className="text-xs font-semibold tracking-[0.06em] text-text uppercase">Ask FMS</h2>
        {!empty && (
          <button
            type="button"
            onClick={() => store.clear()}
            className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-bold text-accent outline-none hover:bg-tile focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MessageSquarePlus className="size-3.5" aria-hidden />
            New chat
          </button>
        )}
      </div>

      {state.notConfigured ? (
        <div
          data-testid="assistant-not-configured"
          className="m-4 mb-auto rounded-tile border border-tile-border bg-tile p-4 text-sm"
        >
          <p className="font-semibold text-text">Assistant isn't set up yet</p>
          <p className="mt-1 text-text-muted">
            The fleet assistant needs to be configured on the server before it can answer questions.
            Ask your administrator to enable it.
          </p>
        </div>
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
        <MessageList
          messages={state.messages}
          onRetry={() => store.retry()}
          onNavigate={onClose}
          renderPreview={renderPreview}
        />
      )}

      <Composer
        streaming={state.streaming}
        disabled={state.notConfigured}
        onSend={(t) => store.send(t)}
        onStop={() => store.stop()}
        draft={draft}
      />
    </div>
  );
}
