import './index.css';

/**
 * F10-R8 / D-089: a public `/share/:token` page boots its own small entry, so it never downloads
 * the app router, session, live-tracking store, worker or admin code. `/driver` (F13) likewise
 * boots its own entry. Everything else is the app.
 */
const root = document.getElementById('root')!;
const path = location.pathname;
const entry = /^\/share\/[^/]+\/?$/.test(path)
  ? import('@/features/share/public/share-entry')
  : /^\/driver\/?$/.test(path)
    ? import('@/features/driver/driver-entry') // F13 / D-099
    : import('@/app/app-entry');
void entry.then((m) => m.mount(root));
