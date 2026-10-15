import { useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { CHAT_MAX_CHARS } from '@shared/contract/assistant.ts';
import { Button } from '@/shared/ui/button';

/** F17-R1/R2: Enter sends, Shift+Enter adds a line; Stop replaces Send while an answer streams. */
export function Composer({
  streaming,
  disabled = false,
  onSend,
  onStop,
  placeholder = 'Ask about vehicles, drivers or reports…',
  autoFocus = true,
}: {
  streaming: boolean;
  disabled?: boolean;
  /** F19: the dashboard chat asks for changes instead. */
  placeholder?: string;
  /** F19: the docked chat on a dashboard page does not grab focus on load. */
  autoFocus?: boolean;
  onSend(text: string): void;
  onStop(): void;
}) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const canSend = !streaming && !disabled && text.trim().length > 0;

  const send = () => {
    if (!canSend) return;
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

  return (
    <form
      className="flex items-end gap-2 border-t border-glass-border p-3"
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
  );
}
