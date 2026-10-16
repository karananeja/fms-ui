/**
 * F30 price table: USD per 1M tokens, per model id. Costs shown in the app are always labelled
 * "estimate". A model missing here is "tokens only" (cost null); never guess a price.
 */

export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** When the prices below were last checked against the providers' price pages. */
export const PRICES_CHECKED = '2026-10-06';

export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
};

export const PRICE_TABLE = { checked: PRICES_CHECKED, models: MODEL_PRICES } as const;

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Estimated USD cost of one run, or null when the model has no price on file. */
export function estimateCost(model: string, t: TokenCounts): number | null {
  const p = MODEL_PRICES[model];
  if (!p) return null;
  return (
    (t.inputTokens * p.input +
      t.outputTokens * p.output +
      t.cacheReadTokens * p.cacheRead +
      t.cacheWriteTokens * p.cacheWrite) /
    1_000_000
  );
}
