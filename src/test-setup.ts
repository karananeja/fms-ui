import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom has no scrolling; the router restores scroll on navigation.
if (typeof window !== 'undefined') window.scrollTo = () => {};

afterEach(cleanup);
