/**
 * Tiny typed wrapper around localStorage with JSON serialization,
 * graceful failure (private mode / quota), and namespacing.
 */

const NAMESPACE = 'meditrack:';

export const storage = {
  get<T>(key: string, fallback: T | null = null): T | null {
    try {
      const raw = window.localStorage.getItem(NAMESPACE + key);
      if (raw === null) return fallback;
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },
  set<T>(key: string, value: T): void {
    try {
      window.localStorage.setItem(NAMESPACE + key, JSON.stringify(value));
    } catch {
      /* ignore quota errors */
    }
  },
  remove(key: string): void {
    try {
      window.localStorage.removeItem(NAMESPACE + key);
    } catch {
      /* ignore */
    }
  },
  clear(): void {
    try {
      for (const k of Object.keys(window.localStorage)) {
        if (k.startsWith(NAMESPACE)) window.localStorage.removeItem(k);
      }
    } catch {
      /* ignore */
    }
  },
};

export const StorageKeys = {
  ACCESS_TOKEN: 'auth:accessToken',
  REFRESH_TOKEN: 'auth:refreshToken',
  USER: 'auth:user',
  AUTH_API_TARGET: 'auth:apiTarget',
  THEME: 'ui:theme',
  SIDEBAR_COLLAPSED: 'ui:sidebarCollapsed',
} as const;
