import type { UsageChat, UsageTotals } from '@shared/contract/index.ts';

const int = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** en-IN integer: 1,23,456. */
export const formatTokens = (v: number) => int.format(v);

/** All input tokens: uncached + read from cache + written to cache. */
export const tokensIn = (
  t: Pick<UsageTotals, 'inputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'>,
) => t.inputTokens + t.cacheReadTokens + t.cacheWriteTokens;

/** `43.2%`, or `—` with no input. */
export const formatRate = (r: number | null) => (r === null ? '—' : `${(r * 100).toFixed(1)}%`);

/** `$1.23`, `$0.0042`; `—` when no price is on file. */
export function formatUsd(v: number | null): string {
  if (v === null) return '—';
  if (v === 0) return '$0.00';
  return v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}

export const CHAT_LABELS: Record<UsageChat, string> = {
  global: 'Ask FMS',
  dashboard: 'Dashboard chat',
  title: 'Auto-title',
};

export const PROVIDER_NAMES: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  xai: 'xAI',
  fake: 'Fake (dev)',
};

export const providerName = (p: string) => PROVIDER_NAMES[p] ?? p;
