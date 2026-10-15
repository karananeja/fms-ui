import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { KeyRound } from 'lucide-react';
import type { AssistantStatus } from '@shared/contract/index.ts';
import { getAssistantStatus } from '../api/ai-keys-api.ts';
import { assistantLabel, notConfiguredText } from '../lib/assistant-label.ts';

/** F25: the assistant status for a chat header, fetched once per mount (each panel open). */
export function useAssistantStatus(): AssistantStatus | null {
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    getAssistantStatus({ signal: ctl.signal }).then(setStatus, () => {});
    return () => ctl.abort();
  }, []);
  return status;
}

/** F25: "xAI Grok · grok-4 · your key" under a chat title; nothing until known. */
export function AssistantModelLabel({ status }: { status: AssistantStatus | null }) {
  const label = status && assistantLabel(status);
  if (!label) return null;
  return (
    <span
      data-testid="assistant-model-label"
      className="truncate text-[11px] text-text-muted"
      title={label}
    >
      {label}
    </span>
  );
}

/** F25: the "not configured" note with a way out: add your own key. */
export function AddKeyNote({
  status,
  onNavigate,
  testId,
}: {
  status: AssistantStatus | null;
  onNavigate?: () => void;
  testId: string;
}) {
  const text =
    (status && notConfiguredText(status)) ??
    'Not configured: add your own key to use the assistant.';
  return (
    <div
      data-testid={testId}
      className="m-4 rounded-tile border border-tile-border bg-tile p-4 text-sm"
    >
      <p className="font-semibold text-text">Assistant isn't set up yet</p>
      <p className="mt-1 text-text-muted">{text}</p>
      <Link
        to="/settings/ai"
        onClick={onNavigate}
        className="mt-3 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-bold text-accent outline-none hover:bg-tile focus-visible:ring-2 focus-visible:ring-ring"
      >
        <KeyRound className="size-3.5" aria-hidden />
        Add your key in Settings
      </Link>
    </div>
  );
}
