import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { RecognitionLike } from '@/shared/hooks/use-dictation';
import { Composer } from './components/composer.tsx';

function fakeRecognition() {
  const made: RecognitionLike[] = [];
  const create = () => {
    const r: RecognitionLike = {
      lang: '',
      continuous: false,
      interimResults: false,
      onresult: null,
      onerror: null,
      onend: null,
      start: vi.fn(),
      stop: vi.fn(() => r.onend?.()),
    };
    made.push(r);
    return r;
  };
  const say = (text: string, isFinal: boolean) =>
    act(() =>
      made.at(-1)!.onresult!({
        resultIndex: 0,
        results: [Object.assign([{ transcript: text }], { isFinal })],
      }),
    );
  return { create, made, say };
}

describe('assistant composer voice input (D-110)', () => {
  it('dictates into the box, shows live words, and stops listening on send', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const voice = fakeRecognition();
    render(
      <Composer streaming={false} onSend={onSend} onStop={vi.fn()} recognition={voice.create} />,
    );

    await user.click(screen.getByRole('button', { name: 'Voice language' }));
    await user.click(screen.getByRole('button', { name: 'Speak your message' }));
    expect(voice.made[0]!.lang).toBe('hi-IN');
    voice.say('show running', false);
    expect(screen.getByTestId('dictation-status')).toHaveTextContent('Listening… show running');
    voice.say('show running vehicles', true);
    expect(screen.getByRole('textbox', { name: 'Message the assistant' })).toHaveValue(
      'Show running vehicles',
    );

    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('Show running vehicles');
    expect(voice.made[0]!.stop).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Speak your message' })).toBeInTheDocument();
  });

  it('has no mic where the browser lacks speech recognition', () => {
    render(<Composer streaming={false} onSend={vi.fn()} onStop={vi.fn()} recognition={null} />);
    expect(screen.queryByRole('button', { name: 'Speak your message' })).toBeNull();
  });
});
