import {
  AI_PROVIDER_LABELS,
  AI_PROVIDERS,
  type AiKeysState,
  type AiKeySummary,
  type AiKeyTestResult,
  type AiProvider,
} from '@shared/contract/index.ts';
import { KeyRound, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { AdminLayout } from '@/features/access/components/admin-layout';
import {
  ConfirmDialog,
  LoadError,
  LockedNote,
  Segmented,
  SelectField,
} from '@/features/access/components/admin-ui';
import { errorText } from '@/features/access/lib/access-format';
import { useResource } from '@/features/access/lib/use-resource';
import { useCan } from '@/features/access/permissions/can';
import { TextField } from '@/features/auth/components/text-field';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import {
  getAiKeys,
  getAiSettings,
  listAiModels,
  removeAiKey,
  saveAiKey,
  testAiKey,
  updateAiSettings,
} from './api/ai-keys-api';
import { assistantLabel, notConfiguredText } from './lib/assistant-label';

const PROVIDER_OPTIONS = AI_PROVIDERS.map((p) => ({ value: p, label: AI_PROVIDER_LABELS[p] }));

const card = 'rounded-tile border border-tile-border bg-tile p-4';
const heading = 'mb-3 text-[11px] font-semibold tracking-[0.06em] text-text-muted uppercase';

/**
 * F25 Settings → AI assistant (route `/settings/ai`, `chat.use`): who answers the chat, the
 * user's saved keys (masked only), add/replace a key with Load models + Test connection, and
 * for `roles.manage` the "Allow the server key as a fallback" switch (D-143).
 */
export function AiKeysPage() {
  const res = useResource((signal) => getAiKeys({ signal }));
  const isAdmin = useCan('roles.manage');
  const state = res.data;
  const update = (next: AiKeysState) => res.setData(() => next);

  return (
    <AdminLayout
      title="AI assistant"
      description="Use your own AI provider key. Keys are encrypted on the server and never shown again."
    >
      {res.error ? <LoadError message={errorText(res.error)} onRetry={res.reload} /> : null}
      {state && (
        <>
          <StatusLine state={state} />
          {!state.storageAvailable && (
            <LockedNote>
              The server can&apos;t store keys right now (no secret key is set). Ask an
              administrator.
            </LockedNote>
          )}
          <SavedKeys state={state} onChange={update} />
          <KeyForm state={state} onSaved={update} />
        </>
      )}
      {!state && !res.error && <p className="text-sm text-text-muted">Loading…</p>}
      {isAdmin && <FallbackSetting onChanged={res.reload} />}
    </AdminLayout>
  );
}

function StatusLine({ state }: { state: AiKeysState }) {
  const label = assistantLabel(state.status);
  return (
    <section aria-label="Assistant status" className={card}>
      <h2 className={heading}>Answering with</h2>
      <p role="status" className={cn('text-sm', !label && 'text-warn')}>
        {label ?? notConfiguredText(state.status)}
      </p>
    </section>
  );
}

function SavedKeys({
  state,
  onChange,
}: {
  state: AiKeysState;
  onChange: (next: AiKeysState) => void;
}) {
  const [confirm, setConfirm] = useState<AiProvider | null>(null);
  const [pending, setPending] = useState(false);

  const run = async (fn: () => Promise<AiKeysState>, done: string) => {
    setPending(true);
    try {
      onChange(await fn());
      toast.success(done);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setPending(false);
      setConfirm(null);
    }
  };

  return (
    <section aria-labelledby="saved-keys-title" className={card}>
      <h2 id="saved-keys-title" className={heading}>
        Your keys
      </h2>
      {state.keys.length === 0 ? (
        <p className="text-sm text-text-muted">
          No keys yet.{' '}
          {state.fallback.allowed && state.fallback.serverConfigured
            ? 'The default assistant is used until you add one.'
            : 'Add one below to use the assistant.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {state.keys.map((k) => (
            <KeyRow
              key={k.provider}
              k={k}
              pending={pending}
              onUse={() =>
                void run(
                  () => saveAiKey(k.provider, { model: k.model }),
                  `Using ${AI_PROVIDER_LABELS[k.provider]}`,
                )
              }
              onRemove={() => setConfirm(k.provider)}
            />
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Remove your ${confirm ? AI_PROVIDER_LABELS[confirm] : ''} key?`}
        description="The key is deleted from the server. You can add it again later."
        confirmLabel="Remove"
        pending={pending}
        onConfirm={() => confirm && void run(() => removeAiKey(confirm), 'Key removed')}
      />
    </section>
  );
}

function KeyRow({
  k,
  pending,
  onUse,
  onRemove,
}: {
  k: AiKeySummary;
  pending: boolean;
  onUse: () => void;
  onRemove: () => void;
}) {
  const name = AI_PROVIDER_LABELS[k.provider];
  return (
    <li
      aria-label={`${name} key`}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-tile border border-tile-border bg-surface-solid px-3 py-2"
    >
      <KeyRound aria-hidden className="size-4 text-text-muted" />
      <span className="font-semibold">{name}</span>
      <span className="text-sm text-text-muted tabular-nums">{k.masked}</span>
      <span className="text-sm">{k.model}</span>
      {!k.readable && (
        <span className="text-xs text-danger">Can&apos;t be read. Paste it again.</span>
      )}
      <span className="ml-auto flex items-center gap-2">
        {k.active ? (
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-accent uppercase">
            Active
          </span>
        ) : (
          <Button size="sm" variant="outline" disabled={pending || !k.readable} onClick={onUse}>
            Use
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="text-danger hover:text-danger"
          aria-label={`Remove ${name} key`}
          disabled={pending}
          onClick={onRemove}
        >
          <Trash2 /> Remove
        </Button>
      </span>
    </li>
  );
}

function KeyForm({ state, onSaved }: { state: AiKeysState; onSaved: (s: AiKeysState) => void }) {
  const [provider, setProvider] = useState<AiProvider>(
    () => state.keys.find((k) => k.active)?.provider ?? 'xai',
  );
  const stored = state.keys.find((k) => k.provider === provider && k.readable);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(stored?.model ?? '');
  const [models, setModels] = useState<string[] | null>(null);
  const [result, setResult] = useState<AiKeyTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'models' | 'test' | 'save'>(null);

  const pickProvider = (p: AiProvider) => {
    setProvider(p);
    setApiKey('');
    setModels(null);
    setResult(null);
    setError(null);
    setModel(state.keys.find((k) => k.provider === p)?.model ?? '');
  };

  const keyArg = apiKey.trim() ? apiKey.trim() : undefined;
  const hasKey = keyArg !== undefined || stored !== undefined;

  const call = async <T,>(kind: 'models' | 'test' | 'save', fn: () => Promise<T>) => {
    setBusy(kind);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(errorText(err));
      return undefined;
    } finally {
      setBusy(null);
    }
  };

  const loadModels = async () => {
    const r = await call('models', () => listAiModels({ provider, apiKey: keyArg }));
    if (!r) return;
    setModels(r.models);
    if (!r.models.includes(model) && r.models[0]) setModel(r.models[0]);
  };

  const test = async () => {
    setResult(null);
    const r = await call('test', () =>
      testAiKey({ provider, apiKey: keyArg, model: model.trim() }),
    );
    if (!r) return;
    setResult(r);
    if (r.models.length) setModels(r.models);
  };

  const save = async () => {
    const r = await call('save', () =>
      saveAiKey(provider, { apiKey: keyArg, model: model.trim() }),
    );
    if (!r) return;
    setApiKey('');
    setResult(null);
    onSaved(r);
    toast.success(`${AI_PROVIDER_LABELS[provider]} key saved`);
  };

  return (
    <section aria-labelledby="add-key-title" className={card}>
      <h2 id="add-key-title" className={heading}>
        {stored ? 'Replace or change your key' : 'Add a key'}
      </h2>
      <div className="mb-4">
        <Segmented
          label="Provider"
          value={provider}
          onChange={pickProvider}
          options={PROVIDER_OPTIONS}
          disabled={busy !== null}
        />
      </div>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <TextField
          id="ai-key"
          label={`${AI_PROVIDER_LABELS[provider]} API key`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          placeholder={stored ? `Leave empty to keep ${stored.masked}` : 'Paste your key'}
          onChange={(e) => {
            setApiKey(e.target.value);
            setResult(null);
          }}
        />
        {models && models.length > 0 ? (
          <SelectField
            id="ai-model"
            label="Model"
            value={model}
            onChange={setModel}
            options={models.map((m) => ({ value: m, label: m }))}
          />
        ) : (
          <TextField
            id="ai-model"
            label="Model"
            value={model}
            placeholder="Load models, or type a model id"
            onChange={(e) => setModel(e.target.value)}
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!hasKey || busy !== null}
            onClick={() => void loadModels()}
          >
            {busy === 'models' ? 'Loading…' : 'Load models'}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!hasKey || !model.trim() || busy !== null}
            onClick={() => void test()}
          >
            {busy === 'test' ? 'Testing…' : 'Test connection'}
          </Button>
          <Button
            type="submit"
            className="ml-auto"
            disabled={!hasKey || !model.trim() || busy !== null || !state.storageAvailable}
          >
            {busy === 'save' ? 'Saving…' : 'Save key'}
          </Button>
        </div>
        {result && (
          <p
            role="status"
            aria-label="Test result"
            className={cn('mt-3 text-sm', result.ok ? 'text-ok' : 'text-danger')}
          >
            {result.message}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}

/** `roles.manage`: whether users without a key may use the server `.env` key (D-143). */
function FallbackSetting({ onChanged }: { onChanged: () => void }) {
  const res = useResource((signal) => getAiSettings({ signal }));
  const [pending, setPending] = useState(false);
  const s = res.data;

  const toggle = async (allowed: boolean) => {
    setPending(true);
    try {
      const next = await updateAiSettings({ allowServerKeyFallback: allowed });
      res.setData(() => next);
      onChanged();
      toast.success(allowed ? 'Default assistant on' : 'Default assistant off');
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <section aria-labelledby="org-ai-title" className={card}>
      <h2 id="org-ai-title" className={heading}>
        Organisation
      </h2>
      {res.error ? <LoadError message={errorText(res.error)} onRetry={res.reload} /> : null}
      {s && (
        <>
          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[var(--accent)]"
              checked={s.allowServerKeyFallback}
              disabled={pending}
              onChange={(e) => void toggle(e.target.checked)}
            />
            Let users without their own key use the default assistant
          </label>
          <p className="mt-1.5 text-xs text-text-muted">
            {s.serverConfigured && s.serverProvider
              ? `The default assistant is ${AI_PROVIDER_LABELS[s.serverProvider]}${s.serverModel ? ` · ${s.serverModel}` : ''}.`
              : 'No default assistant is set up, so users need their own key.'}
          </p>
        </>
      )}
    </section>
  );
}
