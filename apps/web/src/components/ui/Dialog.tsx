'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from './Button';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

/**
 * Built on the native <dialog> element: gets focus trapping, Escape-to-close,
 * and top-layer stacking from the browser instead of reimplementing them.
 */
export function Dialog({ open, onClose, title, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={onClose}
      className="rounded-lg border border-warm-200 bg-warm-50 p-0 backdrop:bg-ink-950/60"
    >
      <div className="flex items-center justify-between border-b border-warm-200 p-4">
        <h2 id={titleId} className="text-lg font-semibold text-ink-950">
          {title}
        </h2>
        <Button variant="ghost" size="md" onClick={onClose} aria-label="Close dialog">
          Close
        </Button>
      </div>
      <div className="p-4">{children}</div>
    </dialog>
  );
}
