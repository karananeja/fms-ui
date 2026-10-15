import type { ReactNode } from 'react';
import type { WidgetType } from '@shared/contract/dashboards.ts';
import {
  RefreshBar,
  WidgetEmpty,
  WidgetIssueState,
  WidgetSkeleton,
} from '../components/widget-states';
import type { WidgetData } from './widget-data';

/** The shared body states (§6.1) around a renderer's content. */
export function DataBody<T>({
  type,
  state,
  isEmpty,
  emptyText,
  children,
}: {
  type: WidgetType;
  state: WidgetData<T>;
  isEmpty?: (data: T) => boolean;
  emptyText?: string;
  children: (data: T) => ReactNode;
}) {
  if (state.issue) return <WidgetIssueState issue={state.issue} onRetry={state.refresh} />;
  if (state.loading || state.data === undefined) return <WidgetSkeleton type={type} />;
  const data = state.data;
  return (
    <>
      <RefreshBar active={state.refreshing} />
      {isEmpty?.(data) ? <WidgetEmpty text={emptyText} /> : children(data)}
    </>
  );
}
