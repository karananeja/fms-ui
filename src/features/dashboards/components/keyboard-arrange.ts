import { useState, type KeyboardEvent } from 'react';
import type { DashboardBreakpoint, LayoutItem } from '@shared/contract/dashboards.ts';
import { arrangeStep, describeItem, type ArrangeKey } from '../lib/layout';

const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

interface Grab {
  id: string;
  title: string;
  orig: LayoutItem[];
  work: LayoutItem[];
}

/**
 * D-133: keyboard alternative to drag/resize. Space/Enter grabs the widget, arrows move it by a
 * cell, Shift+arrows resize, Space/Enter drops (saved like a drag), Escape cancels. Each step is
 * announced through `message` (a polite live region).
 */
export function useKeyboardArrange({
  items,
  bp,
  onCommit,
}: {
  items: LayoutItem[];
  bp: DashboardBreakpoint;
  onCommit(items: LayoutItem[]): void;
}) {
  const [grab, setGrab] = useState<Grab | null>(null);
  const [message, setMessage] = useState('');

  const keyHandler = (id: string, title: string) => (e: KeyboardEvent) => {
    const key = e.key;
    if (!grab || grab.id !== id) {
      if (key === ' ' || key === 'Enter') {
        e.preventDefault();
        setGrab({ id, title, orig: items, work: items });
        setMessage(
          `Grabbed ${title}. Arrow keys move, Shift and arrow keys resize, Space drops, Escape cancels.`,
        );
      }
      return;
    }
    if (ARROWS.has(key)) {
      e.preventDefault();
      const work = arrangeStep(grab.work, id, key as ArrangeKey, e.shiftKey, bp);
      setGrab({ ...grab, work });
      const it = work.find((x) => x.i === id);
      if (it) setMessage(describeItem(it, e.shiftKey));
    } else if (key === ' ' || key === 'Enter') {
      e.preventDefault();
      setGrab(null);
      setMessage(`Dropped ${title}.`);
      onCommit(grab.work);
    } else if (key === 'Escape') {
      e.preventDefault();
      setGrab(null);
      setMessage(`Cancelled. ${title} is back where it was.`);
    }
  };

  return {
    grabbedId: grab?.id ?? null,
    /** The layout to show while a widget is grabbed (null = the normal layout). */
    working: grab?.work ?? null,
    message,
    keyHandler,
    cancel: () => setGrab(null),
  };
}
