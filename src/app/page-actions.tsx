import { use, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PageActionsSlotContext } from './page-actions-context';

/** Renders its children into the top bar's page-actions slot. */
export function PageActions({ children }: { children: ReactNode }) {
  const slot = use(PageActionsSlotContext);
  return slot ? createPortal(children, slot) : null;
}
