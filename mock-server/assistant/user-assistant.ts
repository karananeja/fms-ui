import type { AiSettings, AssistantStatus } from '@shared/contract/index.ts';
import type { MockContext } from '../context.ts';
import { assistantEnv, resolveAssistant, type ResolvedAssistant } from './assistant-config.ts';

/**
 * F25 + F31: which provider/model/key answers this user's chat turns (D-143, D-171 resolution
 * order): the default assistant if picked and allowed → the user's enabled model → the server
 * key if allowed → not configured.
 */
export function resolveForUser(
  ctx: MockContext,
  userId: string,
  fakeAvailable: boolean,
): ResolvedAssistant {
  return resolveAssistant({
    userKey: ctx.aiKeys.userModel(userId),
    allowFallback: ctx.aiKeys.allowServerKeyFallback,
    preferServer: ctx.aiKeys.prefersServer(userId),
    hasKeys: ctx.aiKeys.hasKeys(userId),
    fakeAvailable,
  });
}

/** The browser-safe view of a resolution (never the key), with the picker's options (F31). */
export function statusOf(ctx: MockContext, userId: string, r: ResolvedAssistant): AssistantStatus {
  const configured = r.source !== 'none';
  const settings = aiSettingsOf(ctx);
  return {
    source: r.source,
    provider: configured ? (r.provider ?? null) : null,
    model: configured ? (r.model ?? null) : null,
    fake: r.mode === 'fake',
    reason: r.source === 'none' ? (r.notConfigured ?? 'server_not_configured') : null,
    options: ctx.aiKeys.options(userId),
    serverOption:
      settings.allowServerKeyFallback && settings.serverProvider && settings.serverModel
        ? { provider: settings.serverProvider, model: settings.serverModel }
        : null,
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
