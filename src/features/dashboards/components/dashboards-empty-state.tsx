import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/shared/ui/button';

export const EXAMPLE_PROMPTS = [
  "Show today's running, idle and stopped vehicles by fleet",
  'Top 10 vehicles by idle time this week and open breakdown requests',
  'Daily distance and energy used over the last 30 days',
] as const;

export const PROMPT_MAX = 2000;

/** A small token-coloured illustration: three widget tiles and a spark. */
function Illustration() {
  return (
    <svg viewBox="0 0 160 100" aria-hidden className="h-24 w-auto">
      <rect
        x="8"
        y="10"
        width="64"
        height="38"
        rx="8"
        style={{ fill: 'var(--tile)', stroke: 'var(--tile-border)' }}
      />
      <rect
        x="80"
        y="10"
        width="72"
        height="80"
        rx="8"
        style={{ fill: 'var(--tile)', stroke: 'var(--tile-border)' }}
      />
      <rect
        x="8"
        y="54"
        width="64"
        height="36"
        rx="8"
        style={{ fill: 'var(--tile)', stroke: 'var(--tile-border)' }}
      />
      <rect x="18" y="22" width="26" height="6" rx="3" style={{ fill: 'var(--text-faint)' }} />
      <rect x="18" y="32" width="40" height="8" rx="3" style={{ fill: 'var(--accent)' }} />
      {[0, 1, 2, 3, 4].map((k) => (
        <rect
          key={k}
          x={90 + k * 12}
          y={74 - (k % 3) * 14 - k * 4}
          width="8"
          height={(k % 3) * 14 + k * 4 + 6}
          rx="2"
          style={{ fill: k % 2 ? 'var(--st-charging)' : 'var(--accent)' }}
        />
      ))}
      <circle
        cx="40"
        cy="72"
        r="11"
        fill="none"
        strokeWidth="5"
        style={{ stroke: 'var(--st-running)' }}
      />
      <path
        d="M40 61 a11 11 0 0 1 10 15"
        fill="none"
        strokeWidth="5"
        style={{ stroke: 'var(--st-stopped)' }}
      />
    </svg>
  );
}

/**
 * F23: the list page's "Create with AI" hero (users who already have dashboards): one prompt
 * line, Build, and example prompts that fill it.
 */
export function CreateWithAiHero({
  busy,
  disabled,
  onBuild,
}: {
  busy: boolean;
  /** e.g. at the dashboard limit. */
  disabled?: boolean;
  onBuild(prompt: string): void;
}) {
  const [text, setText] = useState('');
  const prompt = text.trim();
  const off = busy || !!disabled;
  return (
    <section
      data-testid="ai-hero"
      aria-labelledby="ai-hero-title"
      className="relative overflow-hidden rounded-[var(--radius-panel)] border border-accent/25 bg-accent-soft/60 p-4 shadow-panel sm:p-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2 sm:w-56 sm:shrink-0">
          <span className="grid size-9 shrink-0 place-items-center rounded-tile bg-accent text-accent-ink">
            <Sparkles aria-hidden className="size-4" />
          </span>
          <div>
            <h2 id="ai-hero-title" className="text-sm font-semibold">
              Create with AI
            </h2>
            <p className="text-xs text-text-muted">Describe it, FMS builds it</p>
          </div>
        </div>
        <form
          className="flex min-w-0 flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (prompt && prompt.length <= PROMPT_MAX && !off) onBuild(prompt);
          }}
        >
          <label htmlFor="ai-hero-input" className="sr-only">
            Describe a new dashboard
          </label>
          <input
            id="ai-hero-input"
            data-testid="ai-hero-input"
            value={text}
            maxLength={PROMPT_MAX}
            disabled={!!disabled}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Idle vehicles by fleet and today's open requests"
            className="h-9 min-w-0 flex-1 rounded-tile border border-tile-border bg-surface-solid px-3 text-sm outline-none placeholder:text-text-faint focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent/30 disabled:opacity-50"
          />
          <Button type="submit" disabled={!prompt || off} data-testid="ai-hero-build">
            <Sparkles aria-hidden />
            Build
          </Button>
        </form>
      </div>
      <div className="mt-3 flex flex-wrap gap-2" aria-label="Example prompts">
        {EXAMPLE_PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            disabled={!!disabled}
            onClick={() => setText(p)}
            data-testid="ai-hero-example"
            className="min-h-7 rounded-full border border-tile-border bg-surface-solid px-3 py-1 text-left text-xs text-text-muted outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {p}
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * §3 empty state: "Ask FMS to build your first dashboard" with a prompt box and examples that
 * fill it; Start blank creates an empty dashboard. Without `chat.use` only Start blank.
 */
export function DashboardsEmptyState({
  canChat,
  busy,
  onStartBlank,
  onBuild,
  fullPage,
}: {
  canChat: boolean;
  busy: boolean;
  onStartBlank(): void;
  onBuild(prompt: string): void;
  fullPage?: boolean;
}) {
  const [text, setText] = useState('');
  const prompt = text.trim();
  const submit = () => {
    if (prompt && prompt.length <= PROMPT_MAX && !busy) onBuild(prompt);
  };
  return (
    <section
      data-testid="dashboards-empty"
      className={
        fullPage
          ? 'mx-auto flex max-w-xl flex-col items-center gap-4 py-10 text-center'
          : 'flex flex-col items-center gap-4 py-8 text-center'
      }
    >
      <Illustration />
      <h2 className="font-display text-xl font-extrabold tracking-wide">
        {canChat ? 'Ask FMS to build your first dashboard' : 'Create a dashboard to get started'}
      </h2>
      {canChat && (
        <form
          className="w-full space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label htmlFor="dashboard-prompt" className="sr-only">
            Describe the dashboard you want
          </label>
          <textarea
            id="dashboard-prompt"
            rows={3}
            value={text}
            maxLength={PROMPT_MAX}
            placeholder="Describe the dashboard you want…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            className="w-full resize-none rounded-tile border border-tile-border bg-surface-solid p-3 text-sm outline-none placeholder:text-text-faint focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent/30"
          />
          <div className="flex flex-wrap justify-center gap-2" aria-label="Examples">
            {EXAMPLE_PROMPTS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setText(p)}
                data-testid="example-prompt"
                className="min-h-8 rounded-full border border-tile-border bg-tile px-3 py-1 text-left text-xs text-text-muted outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-ring"
              >
                {p}
              </button>
            ))}
          </div>
          <div className="flex justify-center gap-2">
            <Button type="button" variant="outline" onClick={onStartBlank} disabled={busy}>
              Start blank
            </Button>
            <Button type="submit" disabled={!prompt || busy}>
              <Sparkles aria-hidden />
              Build
            </Button>
          </div>
        </form>
      )}
      {!canChat && (
        <>
          <p className="text-sm text-text-muted">
            Building dashboards with the assistant needs chat access; you can still arrange one by
            hand.
          </p>
          <Button type="button" onClick={onStartBlank} disabled={busy}>
            Start blank
          </Button>
        </>
      )}
    </section>
  );
}
