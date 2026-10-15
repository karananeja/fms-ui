import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, Mic, Square } from 'lucide-react';
import { CHAT_MAX_CHARS } from '@shared/contract/assistant.ts';
import {
  appendPhrase,
  DICTATION_LANGS,
  useDictation,
  type DictationLang,
  type RecognitionFactory,
} from '@/shared/hooks/use-dictation';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import type { Suggestion, SuggestionScope } from '../prompt-suggestions.ts';
import { usePromptSuggestions } from '../use-prompt-suggestions.ts';

/**
 * F17-R1/R2: Enter sends, Shift+Enter adds a line; Stop replaces Send while an answer streams.
 * Voice (D-110 dictation, English or Hindi): the mic dictates into the box, live words show
 * underneath, and the user reviews before sending. Hidden where the browser has no support.
 */
export function Composer({
  streaming,
  disabled = false,
  onSend,
  onStop,
  placeholder = 'Ask about vehicles, drivers or reports…',
  autoFocus = true,
  recognition,
  draft = null,
  suggestions = false,
  ariaLabel = 'Message the assistant',
}: {
  streaming: boolean;
  /** F23: type-ahead prompt suggestions for this chat (off by default). */
  suggestions?: SuggestionScope | false;
  /** F23: the dashboard starter's box has its own name. */
  ariaLabel?: string;
  /** D-135 "Ask to change": replaces the text (a new object each time) and focuses the box. */
  draft?: { text: string } | null;
  disabled?: boolean;
  /** F19: the dashboard chat asks for changes instead. */
  placeholder?: string;
  /** F19: the docked chat on a dashboard page does not grab focus on load. */
  autoFocus?: boolean;
  /** Tests inject a fake recognizer; `undefined` uses the browser's. */
  recognition?: RecognitionFactory | null;
  onSend(text: string): void;
  onStop(): void;
}) {
  const [text, setText] = useState('');
  const [lang, setLang] = useState<DictationLang>('en-IN');
  const ref = useRef<HTMLTextAreaElement>(null);
  const dictation = useDictation(
    (phrase) => setText((t) => appendPhrase(t, phrase).slice(0, CHAT_MAX_CHARS)),
    ...(recognition === undefined ? [] : [recognition]),
  );
  const [seenDraft, setSeenDraft] = useState(draft);
  if (draft !== seenDraft) {
    setSeenDraft(draft);
    if (draft) setText(draft.text.slice(0, CHAT_MAX_CHARS));
  }
  useEffect(() => {
    const el = ref.current;
    if (!draft || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [draft]);
  const canSend = !streaming && !disabled && text.trim().length > 0;

  // F23 type-ahead: hidden while dictating, after Esc / accept (until the text changes).
  const listId = useId();
  const all = usePromptSuggestions(text, suggestions || null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [active, setActive] = useState<{ text: string; index: number }>({ text: '', index: -1 });
  const items = dictation.listening || disabled || dismissed === text ? [] : all;
  const open = items.length > 0;
  const activeIndex = active.text === text && active.index < items.length ? active.index : -1;
  const optionId = (i: number) => `${listId}-opt-${i}`;

  const accept = (s: Suggestion) => {
    const next = s.insert.slice(0, CHAT_MAX_CHARS);
    setText(next);
    setDismissed(next);
    const el = ref.current;
    el?.focus();
    requestAnimationFrame(() => el?.setSelectionRange(next.length, next.length));
  };

  const send = () => {
    if (!canSend) return;
    dictation.stop();
    onSend(text);
    setText('');
    ref.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && !e.nativeEvent.isComposing) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        const n = items.length;
        const from = activeIndex < 0 ? (step > 0 ? -1 : n) : activeIndex;
        setActive({ text, index: (from + step + n) % n });
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setDismissed(text);
        return;
      }
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        accept(items[Math.max(0, activeIndex)]!);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && activeIndex >= 0) {
        e.preventDefault();
        accept(items[activeIndex]!);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const status = dictation.listening
    ? `Listening… ${dictation.interim}`.trim()
    : (dictation.error ?? '');

  return (
    <div
      className="relative border-t border-glass-border"
      data-testid="composer"
      data-busy={streaming || undefined}
    >
      {/* F23: the busy state, a thin running bar over the box while an answer streams. */}
      {streaming && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-px h-0.5 animate-pulse bg-accent motion-reduce:animate-none"
        />
      )}
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Suggestions"
          data-testid="prompt-suggestions"
          className="absolute inset-x-3 bottom-full z-20 mb-1 max-h-64 overflow-y-auto rounded-tile border border-glass-border bg-surface-solid p-1 shadow-float"
        >
          {items.map((s, i) => (
            <li
              key={s.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === activeIndex}
              data-testid="prompt-suggestion"
              data-kind={s.kind}
              // Keep focus in the box; a click accepts.
              onMouseDown={(e) => {
                e.preventDefault();
                accept(s);
              }}
              onMouseEnter={() => setActive({ text, index: i })}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-text aria-selected:bg-accent-soft aria-selected:text-accent"
            >
              <span className="min-w-0 flex-1 truncate">
                {s.match ? (
                  <>
                    {s.label.slice(0, s.match[0])}
                    <mark className="rounded-sm bg-transparent font-semibold text-accent">
                      {s.label.slice(s.match[0], s.match[1])}
                    </mark>
                    {s.label.slice(s.match[1])}
                  </>
                ) : (
                  s.label
                )}
              </span>
              {s.hint && <span className="shrink-0 text-[10px] text-text-faint">{s.hint}</span>}
            </li>
          ))}
        </ul>
      )}
      <form
        aria-busy={streaming}
        className="flex items-end gap-2 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        {/* ARIA 1.1 combobox: the wrapper owns the list; the box stays a textbox. */}
        <div
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-owns={open ? listId : undefined}
          className="flex min-w-0 flex-1"
        >
          <textarea
            ref={ref}
            rows={2}
            // The sheet opens straight into typing.
            autoFocus={autoFocus}
            value={text}
            maxLength={CHAT_MAX_CHARS}
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => setDismissed(text)}
            onFocus={() => setDismissed(null)}
            placeholder={streaming ? 'FMS is working… type your next message' : placeholder}
            aria-label={ariaLabel}
            aria-autocomplete={suggestions ? 'list' : undefined}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
            className="max-h-40 min-h-10 flex-1 resize-none rounded-tile border border-tile-border bg-tile px-3 py-2 text-sm text-text outline-none placeholder:text-text-faint focus-visible:border-accent/60 disabled:opacity-50"
          />
        </div>
        {dictation.supported && (
          <div className="flex flex-col items-center gap-1">
            <button
              type="button"
              aria-label="Voice language"
              title="Voice language"
              disabled={dictation.listening}
              onClick={() => setLang((l) => (l === 'en-IN' ? 'hi-IN' : 'en-IN'))}
              className="rounded-full px-1.5 text-[10px] font-semibold text-text-muted hover:text-text disabled:opacity-50"
            >
              {DICTATION_LANGS.find((l) => l.id === lang)!.label}
            </button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={dictation.listening ? 'Stop voice input' : 'Speak your message'}
              aria-pressed={dictation.listening}
              disabled={disabled}
              onClick={() => (dictation.listening ? dictation.stop() : dictation.start(lang))}
              className={cn(
                dictation.listening &&
                  'animate-pulse border-danger text-danger motion-reduce:animate-none',
              )}
            >
              <Mic />
            </Button>
          </div>
        )}
        {streaming ? (
          <Button type="button" variant="outline" size="icon" aria-label="Stop" onClick={onStop}>
            <Square className="fill-current" />
          </Button>
        ) : (
          <Button type="submit" size="icon" aria-label="Send" disabled={!canSend}>
            <ArrowUp />
          </Button>
        )}
      </form>
      {status && (
        <p
          className={cn(
            '-mt-2 px-3 pb-2 text-[11px]',
            dictation.listening ? 'text-text-muted italic' : 'text-danger',
          )}
          aria-live="polite"
          data-testid="dictation-status"
        >
          {status}
        </p>
      )}
    </div>
  );
}
