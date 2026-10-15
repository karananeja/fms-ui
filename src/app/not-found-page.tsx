import { Link } from '@tanstack/react-router';

export function NotFoundPage() {
  return (
    <section className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="font-display text-6xl font-black text-accent">404</p>
      <h1 className="font-display text-xl font-black">Page not found</h1>
      <Link to="/live-tracking" className="text-sm text-text-muted underline hover:text-text">
        Go to live tracking
      </Link>
    </section>
  );
}
