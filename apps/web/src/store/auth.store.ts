import { create } from 'zustand';
import type { AuthSession, AuthTokens, User } from '@/types/auth';
import { configureAuthHooks } from '@/lib/api-client';
import { env } from '@/lib/env';
import { storage, StorageKeys } from '@/lib/storage';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isInitialized: boolean;
  isAuthenticated: boolean;

  setSession: (session: AuthSession) => void;
  updateTokens: (tokens: AuthTokens) => void;
  updateUser: (patch: Partial<User>) => void;
  signOut: () => void;
  /** Called once at app boot to hydrate from storage and wire interceptors. */
  initialize: () => void;
}

const currentApiTarget = env.API_URL.replace(/\/+$/, '');

function clearStoredSession() {
  storage.remove(StorageKeys.USER);
  storage.remove(StorageKeys.ACCESS_TOKEN);
  storage.remove(StorageKeys.REFRESH_TOKEN);
  storage.remove(StorageKeys.AUTH_API_TARGET);
}

function hydrate(): Pick<
  AuthState,
  'user' | 'accessToken' | 'refreshToken' | 'isAuthenticated'
> {
  const storedApiTarget = storage.get<string>(StorageKeys.AUTH_API_TARGET);
  if (storedApiTarget !== currentApiTarget) {
    clearStoredSession();
    return {
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
    };
  }

  const user = storage.get<User>(StorageKeys.USER);
  const accessToken = storage.get<string>(StorageKeys.ACCESS_TOKEN);
  const refreshToken = storage.get<string>(StorageKeys.REFRESH_TOKEN);
  return {
    user,
    accessToken,
    refreshToken,
    isAuthenticated: Boolean(user && accessToken && refreshToken),
  };
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  isInitialized: false,
  isAuthenticated: false,

  setSession: (session) => {
    storage.set(StorageKeys.AUTH_API_TARGET, currentApiTarget);
    storage.set(StorageKeys.USER, session.user);
    storage.set(StorageKeys.ACCESS_TOKEN, session.accessToken);
    storage.set(StorageKeys.REFRESH_TOKEN, session.refreshToken);
    set({
      user: session.user,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      isAuthenticated: true,
    });
  },

  updateTokens: (tokens) => {
    storage.set(StorageKeys.AUTH_API_TARGET, currentApiTarget);
    storage.set(StorageKeys.ACCESS_TOKEN, tokens.accessToken);
    storage.set(StorageKeys.REFRESH_TOKEN, tokens.refreshToken);
    set({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
  },

  updateUser: (patch) => {
    const current = get().user;
    if (!current) return;
    const next = { ...current, ...patch };
    storage.set(StorageKeys.USER, next);
    set({ user: next });
  },

  signOut: () => {
    clearStoredSession();
    set({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
    });
  },

  initialize: () => {
    const hydrated = hydrate();
    set({ ...hydrated, isInitialized: true });

    // Wire axios interceptors to this store (decoupled to avoid circular imports).
    configureAuthHooks({
      onTokensRefreshed: (tokens) => get().updateTokens(tokens),
      onSignOut: () => get().signOut(),
    });
  },
}));

/** Convenience selector hooks to minimize re-renders. */
export const useUser = () => useAuthStore((s) => s.user);
export const useIsAuthenticated = () => useAuthStore((s) => s.isAuthenticated);
