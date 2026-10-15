import { act, fireEvent, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { Responsive, type Layout } from 'react-grid-layout';
import { describe, expect, it, vi } from 'vitest';

/** F20-T1 spike: RGL 2.2.4 `Responsive` under React 19 StrictMode (jsdom). */
describe('F20-T1: react-grid-layout 2.2.4 spike', () => {
  it('mounts in StrictMode without console errors; a resize changes the layout', async () => {
    const errors = vi.spyOn(console, 'error');
    const warns = vi.spyOn(console, 'warn');
    const layouts: Layout[] = [];
    const lg = [
      { i: 'a', x: 0, y: 0, w: 2, h: 2 },
      { i: 'b', x: 2, y: 0, w: 2, h: 2 },
    ];
    const { container } = render(
      <StrictMode>
        <Responsive
          width={1200}
          layouts={{ lg, md: lg, sm: lg }}
          breakpoints={{ lg: 900, md: 600, sm: 0 }}
          cols={{ lg: 12, md: 6, sm: 1 }}
          rowHeight={72}
          margin={[12, 12]}
          dragConfig={{ enabled: true, handle: '.h', threshold: 0 }}
          resizeConfig={{ enabled: true, handles: ['se'] }}
          onDragStop={(l) => layouts.push(l)}
          onResizeStop={(l) => layouts.push(l)}
        >
          <div key="a">
            <span className="h">A</span>
          </div>
          <div key="b">
            <span className="h">B</span>
          </div>
        </Responsive>
      </StrictMode>,
    );
    const handle = container.querySelector('.h')!;
    const step = (fn: () => void) => act(async () => fn());
    await step(() => fireEvent.mouseDown(handle, { clientX: 10, clientY: 10, button: 0 }));
    await step(() => fireEvent.mouseMove(document, { clientX: 400, clientY: 10 }));
    await step(() => fireEvent.mouseMove(document, { clientX: 500, clientY: 10 }));
    await step(() => fireEvent.mouseUp(document, { clientX: 500, clientY: 10 }));
    const resize = container.querySelectorAll('.react-resizable-handle-se')[1]!;
    expect(resize).toBeTruthy();
    await step(() => fireEvent.mouseDown(resize, { clientX: 0, clientY: 0, button: 0 }));
    await step(() => fireEvent.mouseMove(document, { clientX: 200, clientY: 100 }));
    await step(() => fireEvent.mouseUp(document, { clientX: 200, clientY: 100 }));
    // jsdom has no layout boxes, so RGL can't measure a drag here (`getBoundingClientRect` is 0):
    // the mouse drag is proven in e2e (F20-T10); here the drag must at least not throw.
    const resized = layouts.at(-1)!.find((x) => x.i === 'b')!;
    expect(resized.w).toBeGreaterThan(2);
    const all = [...errors.mock.calls, ...warns.mock.calls].map((c) => String(c[0]));
    expect(all.filter((m) => /findDOMNode|Warning|error/i.test(m))).toEqual([]);
  });
});
