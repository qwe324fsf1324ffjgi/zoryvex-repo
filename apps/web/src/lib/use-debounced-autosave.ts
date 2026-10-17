'use client';

import { useEffect, useRef, useState } from 'react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface AutosaveState {
  status: SaveStatus;
  /**
   * Why the last save was refused, when `onSave` threw a reason worth
   * showing. Undefined for a failure with nothing useful to say.
   */
  reason: string | undefined;
}

/**
 * Calls the latest `onSave(value)` `delayMs` after the value stops
 * changing. Never fires on the very first render (only on subsequent
 * changes), so loading existing data doesn't immediately save it back to
 * itself. Uses a ref for the callback so a fresh closure on every render
 * never causes a stale save or an extra effect run.
 *
 * `onSave` may return a Promise — a real network save can fail (unlike the
 * local-adapter writes this hook originally served, which cannot), so this
 * only reports 'saved' once it actually resolves, and 'error' if it
 * rejects, rather than optimistically claiming success.
 *
 * The rejection's message comes back with the status. Some of what stops a
 * save is not a fault at all but something the person can fix in the field
 * in front of them — a pay range with one end filled in, a phone number
 * that is not one — and those refusals arrive here as an Error carrying the
 * sentence to show. Swallowing it left one message for every cause,
 * "Something went wrong. Try again", which is wrong twice: nothing went
 * wrong, and trying again does nothing.
 */
export function useDebouncedAutosave<T>(
  value: T,
  onSave: (value: T) => void | Promise<void>,
  delayMs = 800,
): AutosaveState {
  const [state, setState] = useState<AutosaveState>({ status: 'idle', reason: undefined });
  const isFirstRender = useRef(true);
  const onSaveRef = useRef(onSave);
  const savedTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  onSaveRef.current = onSave;

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setState({ status: 'saving', reason: undefined });
    let cancelled = false;
    const timer = setTimeout(() => {
      Promise.resolve(onSaveRef.current(value))
        .then(() => {
          if (cancelled) return;
          setState({ status: 'saved', reason: undefined });
          clearTimeout(savedTimeout.current);
          savedTimeout.current = setTimeout(
            () => setState({ status: 'idle', reason: undefined }),
            2000,
          );
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          const reason = error instanceof Error ? error.message.trim() : '';
          setState({ status: 'error', reason: reason === '' ? undefined : reason });
        });
    }, delayMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  useEffect(() => () => clearTimeout(savedTimeout.current), []);

  return state;
}
