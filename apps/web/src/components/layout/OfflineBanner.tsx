'use client';

import { useEffect, useState } from 'react';

/**
 * Pure browser API (navigator.onLine + online/offline events) — no
 * adapter dependency, safe to mount everywhere including marketing pages
 * without affecting their bundle weight.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    setOffline(!navigator.onLine);
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="bg-error-700 px-4 py-2 text-center text-sm text-warm-50"
    >
      You're offline. Changes made now will not be saved until you reconnect.
    </div>
  );
}
