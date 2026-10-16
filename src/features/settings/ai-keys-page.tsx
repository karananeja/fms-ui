import {
  AI_PROVIDER_LABELS,
  AI_PROVIDERS,
  type AiKeysState,
  type AiKeySummary,
  type AiProvider,
} from '@shared/contract/index.ts';
import { KeyRound, RefreshCw, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { AdminLayout } from '@/features/access/components/admin-layout';
import {
  ConfirmDialog,
  LoadError,
  LockedNote,
  Segmented,
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
  refreshAiModels,
  removeAiKey,
  saveAiKey,
  setEnabledAiModels,
  updateAiSettings,
} from './api/ai-keys-api';
import { ModelChecklist } from './components/model-checklist';
import { assistantLabel, notConfiguredText } from './lib/assistant-label';

const PROVIDER_OPTIONS = AI_PROVIDERS.map((p) => ({ value: p, label: AI_PROVIDER_LABELS[p] }));

const card = 'rounded-tile border border-tile-border bg-tile p-4';
const heading = 'mb-3 text-[11px] font-semibold tracking-[0.06em] text-text-muted uppercase';

/** A server state from Save / Refresh may carry a notice ("models couldn't be loaded"). */
function showNotice(next: AiKeysState) {
  if (next.notice) toast.warning(next.notice);
}

/**
 * F25 + F31 Settings → AI assistant (route `/settings/ai`, `chat.use`): who answers the chat,
 * add a key (the server checks it and loads its models), the user's keys (masked only) with a
 * model checklist each, and for `roles.manage` the "Allow the server key as a fallback" switch
 * (D-143, D-171).
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
          <KeyForm state={state} onSaved={update} />
          <SavedKeys state={state} onChange={update} />
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

function KeyForm({ state, onSaved }: { state: AiKeysState; onSaved: (s: AiKeysState) => void }) {
  const [provider, setProvider] = useState<AiProvider>(
    () => AI_PROVIDERS.find((p) => !state.keys.some((k) => k.provider === p)) ?? 'xai',
  );
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = AI_PROVIDER_LABELS[provider];
  const existing = state.keys.find((k) => k.provider === provider);

  const save = async () => {
    const key = apiKey.trim();
    if (!key) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await saveAiKey(provider, { apiKey: key });
      setApiKey('');
      onSaved(r);
      setNotice(r.notice ?? null);
      toast.success(`${name} key saved`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="add-key-title" className={card}>
      <h2 id="add-key-title" className={heading}>
        Add a key
      </h2>
      <div className="mb-4">
        <Segmented
          label="Provider"
          value={provider}
          onChange={(p) => {
            setProvider(p);
            setApiKey('');
            setError(null);
            setNotice(null);
          }}
          options={PROVIDER_OPTIONS}
          disabled={busy}
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
          label={`${name} API key`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          placeholder={existing ? `Replaces ${existing.masked}` : 'Paste your key'}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-text-muted">
            We check the key and load its models. Then pick the models to use below.
          </p>
          <Button
            type="submit"
            className="ml-auto"
            disabled={!apiKey.trim() || busy || !state.storageAvailable}
          >
            {busy ? 'Checking key…' : 'Save key'}
          </Button>
        </div>
        {notice && <p className="mt-3 text-sm text-warn">{notice}</p>}
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
      </form>
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

  const remove = async (provider: AiProvider) => {
    setPending(true);
    try {
      onChange(await removeAiKey(provider));
      toast.success('Key removed');
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
            : 'Add one above to use the assistant.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {state.keys.map((k) => (
            <KeyCard
              key={k.provider}
              k={k}
              storageAvailable={state.storageAvailable}
              onChange={onChange}
              onRemove={() => setConfirm(k.provider)}
              removing={pending}
            />
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Remove your ${confirm ? AI_PROVIDER_LABELS[confirm] : ''} key?`}
        description="The key and its enabled models are deleted from the server. You can add it again later."
        confirmLabel="Remove"
        pending={pending}
        onConfirm={() => confirm && void remove(confirm)}
      />
    </section>
  );
}

function KeyCard({
  k,
  storageAvailable,
  onChange,
  onRemove,
  removing,
}: {
  k: AiKeySummary;
  storageAvailable: boolean;
  onChange: (next: AiKeysState) => void;
  onRemove: () => void;
  removing: boolean;
}) {
  const name = AI_PROVIDER_LABELS[k.provider];
  const [busy, setBusy] = useState<null | 'refresh' | 'replace'>(null);
  const [replacing, setReplacing] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [replaceError, setReplaceError] = useState<string | null>(null);
  // Optimistic enabled list while a save is in flight; only the latest request settles it.
  const [optimistic, setOptimistic] = useState<string[] | null>(null);
  const seq = useRef(0);
  const enabled = optimistic ?? k.enabledModels;

  const setEnabled = async (next: string[]) => {
    const id = ++seq.current;
    setOptimistic(next);
    try {
      const r = await setEnabledAiModels(k.provider, next);
      if (id !== seq.current) return;
      onChange(r);
      setOptimistic(null);
    } catch (err) {
      if (id !== seq.current) return;
      setOptimistic(null);
      toast.error(errorText(err));
    }
  };

  const refresh = async () => {
    setBusy('refresh');
    try {
      const r = await refreshAiModels(k.provider);
      onChange(r);
      toast.success(`${name} models refreshed`);
      showNotice(r);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const replace = async () => {
    const key = newKey.trim();
    if (!key) return;
    setBusy('replace');
    setReplaceError(null);
    try {
      const r = await saveAiKey(k.provider, { apiKey: key });
      setNewKey('');
      setReplacing(false);
      onChange(r);
      toast.success(`${name} key replaced`);
      showNotice(r);
    } catch (err) {
      setReplaceError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <li
      aria-label={`${name} key`}
      className="rounded-tile border border-tile-border bg-surface-solid px-3 py-3"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <KeyRound aria-hidden className="size-4 text-text-muted" />
        <span className="font-semibold">{name}</span>
        <span className="text-sm text-text-muted tabular-nums">{k.masked}</span>
        {k.readable && (
          <span className="text-xs text-text-muted tabular-nums">
            {enabled.length} of {k.availableModels.length} models enabled
          </span>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-1">
          {k.readable && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => void refresh()}
            >
              <RefreshCw className={cn(busy === 'refresh' && 'animate-spin')} />
              {busy === 'refresh' ? 'Refreshing…' : 'Refresh models'}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            aria-expanded={replacing}
            disabled={busy !== null || !storageAvailable}
            onClick={() => {
              setReplacing((r) => !r);
              setNewKey('');
              setReplaceError(null);
            }}
          >
            Replace key
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-danger hover:text-danger"
            aria-label={`Remove ${name} key`}
            disabled={removing || busy !== null}
            onClick={onRemove}
          >
            <Trash2 /> Remove
          </Button>
        </span>
      </div>

      {replacing && (
        <form
          noValidate
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void replace();
          }}
        >
          <TextField
            id={`replace-key-${k.provider}`}
            label={`New ${name} API key`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            className="mb-0 min-w-56 flex-1"
            value={newKey}
            placeholder="Paste the new key"
            onChange={(e) => setNewKey(e.target.value)}
          />
          <Button type="submit" className="h-11" disabled={!newKey.trim() || busy !== null}>
            {busy === 'replace' ? 'Checking key…' : 'Save'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-11"
            disabled={busy !== null}
            onClick={() => setReplacing(false)}
          >
            Cancel
          </Button>
          {replaceError && (
            <p role="alert" className="w-full text-sm text-danger">
              {replaceError}
            </p>
          )}
        </form>
      )}

      {!k.readable ? (
        <p className="mt-2 text-xs text-danger">Can&apos;t be read. Paste it again.</p>
      ) : k.availableModels.length === 0 ? (
        <p className="mt-2 text-sm text-text-muted">No models loaded. Try Refresh models.</p>
      ) : (
        <ModelChecklist
          name={name}
          available={k.availableModels}
          enabled={enabled}
          disabled={!storageAvailable}
          onChange={(next) => void setEnabled(next)}
        />
      )}
    </li>
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
