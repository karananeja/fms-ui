import { createContext, use, useEffect, useMemo, useState } from 'react';
import { can } from '@/features/access/permissions/can';
import { selectMe, useSession } from '@/features/auth/session/use-session';
import { liveTrackingStore } from '@/features/live-tracking/store/live-tracking-store';
import {
  entitySuggestions,
  lastToken,
  looksLikeVehicle,
  matchPrompts,
  mergeSuggestions,
  PROMPT_TEMPLATES,
  type Suggestion,
  type SuggestionScope,
} from './prompt-suggestions.ts';

/** Where entity completion reads vehicles and fleets (the live-tracking worker by default). */
export interface EntitySource {
  vehicles(prefix: string): Promise<readonly { vehicleId: string; regno: string; vin: string }[]>;
  fleets(): readonly { id: string; name: string }[];
}

const workerSource: EntitySource = {
  vehicles: (prefix) => liveTrackingStore.suggest(prefix, 'all').catch(() => []),
  fleets: () => liveTrackingStore.getSnapshot().fleets,
};

/** Tests inject a fake source. */
export const EntitySourceContext = createContext<EntitySource>(workerSource);

export const SUGGEST_DEBOUNCE_MS = 150;

/**
 * F23: type-ahead suggestions for a composer, debounced ~150 ms, permission-filtered; entity
 * completion only with `live.view` (the worker search, no model call). `scope` null = off.
 */
export function usePromptSuggestions(text: string, scope: SuggestionScope | null): Suggestion[] {
  const me = useSession(selectMe);
  const source = use(EntitySourceContext);
  const templates = useMemo(
    () =>
      scope
        ? PROMPT_TEMPLATES.filter(
            (t) => t.scopes.includes(scope) && t.needs.every((p) => can(me, p)),
          )
        : [],
    [me, scope],
  );
  const live = can(me, 'live.view');
  const [result, setResult] = useState<{ text: string; items: Suggestion[] }>({
    text: '',
    items: [],
  });
  useEffect(() => {
    if (!scope || !text.trim()) return;
    let current = true;
    const timer = setTimeout(() => {
      void (async () => {
        const prompts = matchPrompts(text, templates);
        const { token } = lastToken(text);
        const vehicles = live && looksLikeVehicle(token) ? await source.vehicles(token) : [];
        const fleets = live ? source.fleets() : [];
        if (current)
          setResult({
            text,
            items: mergeSuggestions(entitySuggestions(text, vehicles, fleets), prompts),
          });
      })();
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [text, scope, templates, live, source]);
  return scope && result.text === text ? result.items : [];
}
