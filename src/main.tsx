import './index.css';

/**
 * F10-R8 / D-089: a public `/share/:token` page boots its own small entry, so it never downloads
 * the app router, session, live-tracking store, worker or admin code. Everything else is the app.
 */
const root = document.getElementById('root')!;
const entry = /^\/share\/[^/]+\/?$/.test(location.pathname)
  ? import('@/features/share/public/share-entry')
  : import('@/app/app-entry');
void entry.then((m) => m.mount(root));
