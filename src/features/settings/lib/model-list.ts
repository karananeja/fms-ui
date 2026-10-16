import { MAX_ENABLED_MODELS } from '@shared/contract/index.ts';

/** F31: enabled models first (in enabled order), then the rest in the provider's order. */
export function orderModels(available: readonly string[], enabled: readonly string[]): string[] {
  const set = new Set(available);
  const first = enabled.filter((m) => set.has(m));
  const on = new Set(first);
  return [...first, ...available.filter((m) => !on.has(m))];
}

export function matchesQuery(model: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || model.toLowerCase().includes(q);
}

/** "All" on the filtered list: keeps the enabled order, appends filtered models up to the cap. */
export function enableAll(enabled: readonly string[], filtered: readonly string[]): string[] {
  const next = [...enabled];
  for (const m of filtered) {
    if (next.length >= MAX_ENABLED_MODELS) break;
    if (!next.includes(m)) next.push(m);
  }
  return next;
}

/** "Clear" on the filtered list. */
export function clearFiltered(enabled: readonly string[], filtered: readonly string[]): string[] {
  const drop = new Set(filtered);
  return enabled.filter((m) => !drop.has(m));
}
