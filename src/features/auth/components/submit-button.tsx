import type { ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Button } from '@/shared/ui/button';

/** One full-width accent button; disabled with a spinner while the request is in flight. */
export function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <Button
      type="submit"
      size="lg"
      disabled={pending}
      aria-busy={pending}
      className="auth-shimmer relative mt-2 h-11 w-full overflow-hidden rounded-tile"
    >
      {pending && <LoaderCircle className="animate-spin" aria-hidden />}
      {children}
    </Button>
  );
}
