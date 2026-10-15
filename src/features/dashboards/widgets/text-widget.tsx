import type { Widget } from '@shared/contract/dashboards.ts';
import { Markdown } from '@/features/assistant/components/markdown';

const plain = (_: unknown, text: string) => text;

/** §6.3: a note in the F17 markdown subset (never HTML); scrolls inside the widget. */
export function TextWidget({ w }: { w: Extract<Widget, { type: 'text' }> }) {
  return (
    <div
      className="widget-no-drag h-full space-y-2 overflow-auto text-sm"
      data-testid="text-widget"
    >
      <Markdown text={w.body} renderEntity={plain} />
    </div>
  );
}
