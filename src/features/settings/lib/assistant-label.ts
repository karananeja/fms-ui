import {
  AI_PROVIDER_LABELS,
  type AiProvider,
  type AssistantStatus,
} from '@shared/contract/index.ts';

/** F31: short provider names for the chat model picker button ("Claude · claude-opus-5-5"). */
export const AI_PROVIDER_SHORT_LABELS: Record<AiProvider, string> = {
  xai: 'Grok',
  openai: 'OpenAI',
  anthropic: 'Claude',
};

/**
 * F25: one-line label of who answers the chat, for the assistant panel / dashboard dock header,
 * e.g. "OpenAI · gpt-5 · your key". The shared server key is never named in the UI (user
 * request): it shows provider and model only. `null` when not configured.
 */
export function assistantLabel(status: AssistantStatus): string | null {
  if (status.source === 'none' || !status.provider) return null;
  const parts = [AI_PROVIDER_LABELS[status.provider]];
  if (status.model) parts.push(status.model);
  if (status.source === 'user') parts.push('your key');
  return parts.join(' · ') + (status.fake ? ' (fake model)' : '');
}

/** F31: the compact picker button text, e.g. "Claude · claude-opus-5-5". `null` when none. */
export function shortAssistantLabel(status: AssistantStatus): string | null {
  if (status.source === 'none' || !status.provider) return null;
  const name = AI_PROVIDER_SHORT_LABELS[status.provider];
  return status.model ? `${name} · ${status.model}` : name;
}

/** Why the assistant can't answer, for the status line and the chat's "not configured" note. */
export function notConfiguredText(status: AssistantStatus): string | null {
  if (status.source !== 'none') return null;
  if (status.reason === 'no_models_enabled')
    return 'Not configured: enable a model for one of your keys in Settings.';
  return status.reason === 'fallback_disabled'
    ? 'Not configured: add your own key. Your organisation has turned off the default assistant.'
    : 'Not configured: add your own key to use the assistant.';
}
