'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

type ToastTone = 'info' | 'success' | 'error';

interface ToastMessage {
  id: string;
  text: string;
  tone: ToastTone;
}

interface ToastContextValue {
  showToast: (text: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_CLASSES: Record<ToastTone, string> = {
  info: 'bg-ink-950 text-warm-50',
  success: 'bg-accent-700 text-warm-50',
  error: 'bg-error-700 text-warm-50',
};

const AUTO_DISMISS_MS = 6000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /**
   * Errors stay until they are dismissed. Everything else still clears
   * itself after six seconds.
   *
   * Every toast used to vanish on the same timer, and errors are not
   * announcements: "Payment failed. No charge was completed." reached the
   * reader only this way, with no inline copy behind it, and six seconds is
   * not long enough to read a sentence that matters, decide what it means
   * and act on it. Somebody who looked away lost it with no way to ask what
   * it said. That is also what WCAG 2.2.1 is about, and a message the reader
   * cannot extend or recall does not satisfy it.
   *
   * Successes are genuinely transient and keeping them would turn the corner
   * of the screen into a list nobody asked for, so they are unchanged.
   */
  const showToast = useCallback(
    (text: string, tone: ToastTone = 'info') => {
      const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      setToasts((prev) => [...prev, { id, text, tone }]);
      if (tone === 'error') return;
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  // Memoised because this provider wraps the whole app and re-renders every
  // time a toast appears or auto-dismisses. A fresh object here made every
  // consumer of useToast() re-render on each of those, which is most pages,
  // for a value that never actually changes: showToast is itself stable.
  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/*
        `pointer-events-none` because this layer is fixed at z-50 over the
        whole app and holds nothing anybody can click. Without it a toast
        swallows every click landing in the bottom-right corner for the six
        seconds it is up, which is the corner a form's submit button tends to
        sit in, and the click is lost with no visible reason. The empty
        container collapses to zero size and was never the problem; the
        visible toast was.

        If a toast ever gains a control, that control needs
        `pointer-events-auto` on itself rather than this line being removed.
      */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'flex items-start gap-3 rounded-md px-4 py-2 text-sm shadow-lg',
              TONE_CLASSES[toast.tone],
            )}
          >
            <span id={`${toast.id}_text`}>{toast.text}</span>
            {/*
              pointer-events-auto on the control itself, which is exactly what
              the note above says to do when a toast gains one. The layer
              stays click-through so a toast never swallows a press meant for
              the form underneath it.

              Present on every tone, not only on errors. A success that is
              covering something can be got rid of, and a reader who has
              finished with an error should not have to wait for it.
            */}
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              /*
                The name is the action and nothing else. The message it
                belongs to is a description, not part of the name.

                The first version of this put the whole message in the
                aria-label, so a toast reading "Evidence item removed."
                produced a button called "Dismiss: Evidence item removed."
                That is wrong twice over. A screen reader announces a button
                by its name, and a name that is an entire sentence is not an
                action anybody can act on. And it collides: an accessible
                name is what every by-name query matches against, so this
                button started answering to "Remove" and broke a moderation
                test that counts Remove buttons. Both are the same mistake,
                and the test caught the half that was visible.
              */
              aria-label="Dismiss notification"
              aria-describedby={`${toast.id}_text`}
              className="pointer-events-auto -mr-1 shrink-0 rounded px-1 font-medium underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warm-50"
            >
              Dismiss
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
