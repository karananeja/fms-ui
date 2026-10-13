import { useMatch } from '@tanstack/react-router';

export function PlaceholderPage() {
  const title = useMatch({ strict: false, select: (m) => m.staticData.title }) ?? 'Page';
  return (
    <section className="flex h-full min-h-60 flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="text-2xl font-extrabold">{title}</h1>
      <p className="text-sm text-text-muted">Coming soon</p>
    </section>
  );
}
