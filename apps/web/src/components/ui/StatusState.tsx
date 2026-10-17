import type { ReactNode } from 'react';
import { Card } from './Card';

export type StatusStateKind = 'empty' | '403' | '404' | '409' | '422' | '429' | '500' | 'offline';

const DEFAULTS: Record<StatusStateKind, { title: string; body: string }> = {
  empty: { title: 'Nothing here yet', body: 'Once something exists, it shows up here.' },
  '403': {
    title: "You don't have access to this",
    body: 'This belongs to a different account. If you think that is wrong, contact support.',
  },
  '404': { title: 'Not found', body: "This doesn't exist, or was deleted." },
  '409': {
    title: 'Already handled',
    body: 'Someone (or something) already completed this action. Nothing more to do here.',
  },
  '422': {
    title: "That didn't go through",
    body: 'Check the highlighted fields and try again.',
  },
  '429': {
    title: 'Slow down',
    body: "That's too many at once. Wait a moment and try again with fewer.",
  },
  '500': {
    title: 'Something went wrong on our end',
    body: 'This was not your fault. Try again in a moment.',
  },
  offline: {
    title: "You're offline",
    body: 'Changes made now will not be saved. Reconnect and try again.',
  },
};

export interface StatusStateProps {
  kind: StatusStateKind;
  title?: string;
  body?: string;
  action?: ReactNode;
}

export function StatusState({ kind, title, body, action }: StatusStateProps) {
  const defaults = DEFAULTS[kind];
  const role = kind === '500' || kind === '429' || kind === 'offline' ? 'alert' : 'status';
  return (
    <Card role={role} aria-live={role === 'alert' ? 'assertive' : 'polite'}>
      <p className="font-semibold text-ink-950">{title ?? defaults.title}</p>
      <p className="mt-1 text-sm text-ink-700">{body ?? defaults.body}</p>
      {action && <div className="mt-4">{action}</div>}
    </Card>
  );
}
