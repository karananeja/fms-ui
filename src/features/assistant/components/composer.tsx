import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
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
}: {
  streaming: boolean;
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

  const send = () => {
    if (!canSend) return;
    dictation.stop();
    onSend(text);
    setText('');
    ref.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const status = dictation.listening
    ? `Listening… ${dictation.interim}`.trim()
    : (dictation.error ?? '');

  return (
    <div className="border-t border-glass-border">
      <form
        className="flex items-end gap-2 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
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
          placeholder={placeholder}
          aria-label="Message the assistant"
          className="max-h-40 min-h-10 flex-1 resize-none rounded-tile border border-tile-border bg-tile px-3 py-2 text-sm text-text outline-none placeholder:text-text-faint focus-visible:border-accent/60 disabled:opacity-50"
        />
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
