import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { Sparkles } from 'lucide-react';
import { useCan } from '@/features/access/permissions/can';
import { Button } from '@/shared/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/shared/ui/sheet';

// F17-R6: the panel, store and stream parser are one lazy chunk; the shell carries only this button.
const loadPanel = () => import('./assistant-panel.tsx');
const AssistantPanel = lazy(() => loadPanel().then((m) => ({ default: m.AssistantPanel })));

/**
 * F17-R1: "Ask FMS" in the header (`chat.use`). Opens a right sheet: 420 px on desktop,
 * full-screen on mobile. Closing keeps the conversation (the store outlives the sheet).
 */
export function AskFmsButton() {
  const allowed = useCan('chat.use');
  const [open, setOpen] = useState(false);
  // F29: an Activity "Open chat" link (`?thread=<id>`) opens that saved conversation.
  const thread = useRouterState({
    select: (s) => (s.location.search as { thread?: unknown }).thread,
  });
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!allowed || typeof thread !== 'string' || opened.current === thread) return;
    opened.current = thread;
    setOpen(true);
    void import('../assistant-store.ts').then(({ assistantStore }) => assistantStore.load(thread));
  }, [allowed, thread]);
  if (!allowed) return null;
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="sm"
        data-testid="ask-fms"
        aria-label="Ask FMS"
        onPointerEnter={() => void loadPanel()}
        onFocus={() => void loadPanel()}
        onClick={() => setOpen(true)}
      >
        <Sparkles className="text-accent" />
        <span className="hidden sm:inline">Ask FMS</span>
      </Button>
      <SheetContent
        side="right"
        aria-label="Ask FMS"
        // F23: Esc first closes an open suggestion list, not the sheet.
        onEscapeKeyDown={(e) => {
          if (document.activeElement?.closest('[role="combobox"][aria-expanded="true"]'))
            e.preventDefault();
        }}
        className="w-full gap-0 border-glass-border bg-surface-solid sm:w-[420px] sm:max-w-[420px]"
      >
        <SheetTitle className="sr-only">Ask FMS</SheetTitle>
        <SheetDescription className="sr-only">
          Fleet assistant: ask about vehicles, drivers and reports
        </SheetDescription>
        {open && (
          <Suspense fallback={<p className="p-4 text-sm text-text-muted">Loading assistant…</p>}>
            <AssistantPanel onClose={() => setOpen(false)} />
          </Suspense>
        )}
      </SheetContent>
    </Sheet>
  );
}
