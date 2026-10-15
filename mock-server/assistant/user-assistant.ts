import type { AiSettings, AssistantStatus } from '@shared/contract/index.ts';
import type { MockContext } from '../context.ts';
import { assistantEnv, resolveAssistant, type ResolvedAssistant } from './assistant-config.ts';

/** F25: which provider/model/key answers this user's chat turns (D-143 resolution order). */
export function resolveForUser(
  ctx: MockContext,
  userId: string,
  fakeAvailable: boolean,
): ResolvedAssistant {
  return resolveAssistant({
    userKey: ctx.aiKeys.activeKey(userId),
    allowFallback: ctx.aiKeys.allowServerKeyFallback,
    fakeAvailable,
  });
}

/** The browser-safe view of a resolution (never the key). */
export function statusOf(r: ResolvedAssistant): AssistantStatus {
  const configured = r.source !== 'none';
  return {
    source: r.source,
    provider: configured ? (r.provider ?? null) : null,
    model: configured ? (r.model ?? null) : null,
    fake: r.mode === 'fake',
    reason: r.source === 'none' ? (r.notConfigured ?? 'server_not_configured') : null,
  };
}

/** The org setting plus what the server env (F21) would answer with. */
export function aiSettingsOf(ctx: MockContext): AiSettings {
  const env = assistantEnv();
  const configured = env.mode !== 'not-configured';
  return {
    allowServerKeyFallback: ctx.aiKeys.allowServerKeyFallback,
    serverConfigured: configured,
    serverProvider: configured ? (env.provider ?? null) : null,
    serverModel: configured ? (env.model ?? null) : null,
  };
}
