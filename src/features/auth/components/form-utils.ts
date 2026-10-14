import { ApiError } from '@/shared/api/api-client';

export const UNREACHABLE = "Couldn't reach the server. Try again.";

/** Field errors keyed by field name; empty = valid. */
export type FieldErrors<K extends string> = Partial<Record<K, string>>;

/** F02-R13: moves focus to the first invalid field, in form order. */
export function focusFirstInvalid<K extends string>(
  order: readonly K[],
  errors: FieldErrors<K>,
  refs: Partial<Record<K, HTMLInputElement | null>>,
): void {
  const first = order.find((k) => errors[k]);
  if (first) refs[first]?.focus();
}

/** Server validation issues (`422 validation_failed`) as field messages, keyed by `path[0]`. */
export function serverFieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || !Array.isArray(err.details)) return {};
  const out: Record<string, string> = {};
  for (const issue of err.details as { path?: unknown[]; message?: string }[]) {
    const key = String(issue.path?.[0] ?? '');
    if (key && issue.message && !out[key]) out[key] = issue.message;
  }
  return out;
}

export const isStatus = (err: unknown, ...statuses: number[]) =>
  err instanceof ApiError && statuses.includes(err.status);

export const isUnreachable = (err: unknown) => !(err instanceof ApiError) || err.unreachable;
