import { useCallback, useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Check, ChevronDown, KeyRound, Settings2 } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { toast } from 'sonner';
import {
  AI_PROVIDER_LABELS,
  AI_PROVIDERS,
  type AiModelChoice,
  type AssistantStatus,
} from '@shared/contract/index.ts';
import { errorText } from '@/features/access/lib/access-format';
import { cn } from '@/shared/lib/utils';
import { chooseAssistantModel, getAssistantStatus } from '../api/ai-keys-api.ts';
import { assistantLabel, notConfiguredText, shortAssistantLabel } from '../lib/assistant-label.ts';

export interface AssistantStatusHandle {
  status: AssistantStatus | null;
  setStatus: (next: AssistantStatus) => void;
  /** Fetch the status again (the picker does this when its menu opens). */
  reload: () => void;
}

/** F25 / F31: the assistant status for a chat header, fetched once per mount (each panel open). */
export function useAssistantStatus(): AssistantStatusHandle {
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    getAssistantStatus({ signal: ctl.signal }).then(setStatus, () => {});
    return () => ctl.abort();
  }, []);
  const reload = useCallback(() => {
    getAssistantStatus().then(setStatus, () => {});
  }, []);
  return { status, setStatus, reload };
}

const SERVER_VALUE = 'server';
const choiceValue = (c: AiModelChoice) => `${c.provider}:${c.model}`;

const menuItem =
  'flex min-h-8 cursor-pointer items-center gap-2 rounded-md py-1.5 pr-2.5 pl-7 text-sm outline-none select-none relative data-[disabled]:opacity-50 data-[highlighted]:bg-tile data-[highlighted]:text-accent';
const groupLabel =
  'px-2.5 pt-2 pb-1 text-[10px] font-semibold tracking-[0.06em] text-text-muted uppercase';

/**
 * F31 (§5): the chat header's model picker: a compact button with the current model, opening a
 * menu of the user's enabled models (one group per provider), the default assistant when the
 * org allows it, and a "Manage models" link. The choice is shared by both chats.
 */
export function ModelPicker({
  assistant,
  disabled,
  onNavigate,
}: {
  assistant: AssistantStatusHandle;
  /** True while a turn is streaming. */
  disabled?: boolean;
  onNavigate?: () => void;
}) {
  const { status, setStatus, reload } = assistant;
  const [pending, setPending] = useState(false);
  if (!status) return null;
  if (status.source === 'none' && status.options.length === 0 && !status.serverOption) return null;

  const current =
    status.source === 'server'
      ? SERVER_VALUE
      : status.source === 'user' && status.provider && status.model
        ? choiceValue({ provider: status.provider, model: status.model })
        : '';
  const label = shortAssistantLabel(status) ?? 'Choose a model';
  const groups = AI_PROVIDERS.map((p) => ({
    provider: p,
    models: status.options.filter((o) => o.provider === p),
  })).filter((g) => g.models.length > 0);

  const choose = async (value: string) => {
    if (value === current) return;
    setPending(true);
    try {
      const input =
        value === SERVER_VALUE
          ? ({ source: 'server' } as const)
          : status.options.find((o) => choiceValue(o) === value);
      if (!input) return;
      setStatus(await chooseAssistantModel(input));
    } catch (err) {
      toast.error(errorText(err));
      reload();
    } finally {
      setPending(false);
    }
  };

  return (
    <DropdownMenu.Root
      onOpenChange={(open) => {
        if (open) reload();
      }}
    >
      <DropdownMenu.Trigger
        data-testid="assistant-model-picker"
        disabled={disabled || pending}
        title={assistantLabel(status) ?? undefined}
        aria-label={`Model: ${label}`}
        className="flex max-w-full min-w-0 items-center gap-1 self-start rounded-md px-1 py-0.5 text-[11px] text-text-muted outline-none hover:bg-tile hover:text-text focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 data-[state=open]:text-text"
      >
        <span className="truncate">{label}</span>
        <ChevronDown aria-hidden className="size-3 shrink-0" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          aria-label="Choose a model"
          className="z-[70] max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] w-72 overflow-y-auto rounded-tile border border-glass-border bg-surface-solid p-1.5 text-text shadow-float"
        >
          <DropdownMenu.RadioGroup value={current} onValueChange={(v) => void choose(v)}>
            {groups.map((g) => (
              <DropdownMenu.Group key={g.provider}>
                <DropdownMenu.Label className={groupLabel}>
                  {AI_PROVIDER_LABELS[g.provider]}
                </DropdownMenu.Label>
                {g.models.map((o) => (
                  <PickerItem key={o.model} value={choiceValue(o)} text={o.model} />
                ))}
              </DropdownMenu.Group>
            ))}
            {status.serverOption && (
              <>
                {groups.length > 0 && (
                  <DropdownMenu.Separator className="my-1 h-px bg-glass-border" />
                )}
                <PickerItem
                  value={SERVER_VALUE}
                  text={`Default assistant · ${status.serverOption.model}`}
                />
              </>
            )}
          </DropdownMenu.RadioGroup>
          {groups.length === 0 && !status.serverOption && (
            <p className="px-2.5 py-2 text-xs text-text-muted">No models enabled yet.</p>
          )}
          <DropdownMenu.Separator className="my-1 h-px bg-glass-border" />
          <DropdownMenu.Item asChild className={cn(menuItem, 'pl-2.5 text-accent')}>
            <Link to="/settings/ai" onClick={onNavigate}>
              <Settings2 aria-hidden className="size-4" />
              Manage models
            </Link>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function PickerItem({ value, text }: { value: string; text: string }) {
  return (
    <DropdownMenu.RadioItem value={value} className={menuItem}>
      <DropdownMenu.ItemIndicator className="absolute left-2 inline-flex">
        <Check aria-hidden className="size-3.5 text-accent" />
      </DropdownMenu.ItemIndicator>
      <span className="truncate">{text}</span>
    </DropdownMenu.RadioItem>
  );
}

/** F25: the "not configured" note with a way out: add your own key (F31: or enable a model). */
export function AddKeyNote({
  status,
  onNavigate,
  testId,
}: {
  status: AssistantStatus | null;
  onNavigate?: () => void;
  testId: string;
}) {
  const text =
    (status && notConfiguredText(status)) ??
    'Not configured: add your own key to use the assistant.';
  const enable = status?.reason === 'no_models_enabled';
  return (
    <div
      data-testid={testId}
      className="m-4 rounded-tile border border-tile-border bg-tile p-4 text-sm"
    >
      <p className="font-semibold text-text">Assistant isn't set up yet</p>
      <p className="mt-1 text-text-muted">{text}</p>
      <Link
        to="/settings/ai"
        onClick={onNavigate}
        className="mt-3 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-bold text-accent outline-none hover:bg-tile focus-visible:ring-2 focus-visible:ring-ring"
      >
        <KeyRound className="size-3.5" aria-hidden />
        {enable ? 'Enable a model in Settings' : 'Add your key in Settings'}
      </Link>
    </div>
  );
}
