/**
 * Thin wrapper over localStorage. Falls back to an in-memory Map when
 * localStorage isn't available (server-side render pass of a static
 * export build, or a Node test environment without jsdom) so importing
 * this module never throws — callers in client components still only
 * ever see real persistence once they run in a browser.
 */

const NAMESPACE = 'zoryvex:local:';

function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

const memoryStore = new Map<string, string>();

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
  keys(prefix: string): string[];
  clear(prefix: string): void;
}

class BrowserOrMemoryStore implements KeyValueStore {
  private prefixed(key: string): string {
    return `${NAMESPACE}${key}`;
  }

  get(key: string): string | null {
    if (hasLocalStorage()) return window.localStorage.getItem(this.prefixed(key));
    return memoryStore.get(this.prefixed(key)) ?? null;
  }

  set(key: string, value: string): void {
    if (hasLocalStorage()) {
      window.localStorage.setItem(this.prefixed(key), value);
      return;
    }
    memoryStore.set(this.prefixed(key), value);
  }

  delete(key: string): void {
    if (hasLocalStorage()) {
      window.localStorage.removeItem(this.prefixed(key));
      return;
    }
    memoryStore.delete(this.prefixed(key));
  }

  keys(prefix: string): string[] {
    const full = this.prefixed(prefix);
    if (hasLocalStorage()) {
      const out: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(full)) out.push(k.slice(NAMESPACE.length));
      }
      return out;
    }
    return [...memoryStore.keys()]
      .filter((k) => k.startsWith(full))
      .map((k) => k.slice(NAMESPACE.length));
  }

  clear(prefix: string): void {
    for (const key of this.keys(prefix)) this.delete(key);
  }
}

export const store: KeyValueStore = new BrowserOrMemoryStore();

export function getJSON<T>(key: string): T | null {
  const raw = store.get(key);
  if (raw === null) return null;
  return JSON.parse(raw) as T;
}

export function setJSON<T>(key: string, value: T): void {
  store.set(key, JSON.stringify(value));
}
