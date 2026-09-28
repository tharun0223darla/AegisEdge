import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';
import { Capacitor } from '@capacitor/core';
import { env } from './env';
import { storage, StorageKeys } from './storage';
import type { AuthTokens, User } from '@/types/auth';
import type { ApiError } from '@/types/common';

/* ─────────────────────────────────────────────────────────────
   Axios instance with two interceptors:
   - Request: attach Bearer token
   - Response: on 401 → call /auth/refresh once, queue parallel
     requests during the refresh, retry, or sign out on failure.
   ───────────────────────────────────────────────────────────── */

let isRefreshing = false;
let pendingQueue: Array<{
  resolve: (token: string) => void;
  reject: (err: unknown) => void;
}> = [];

function flushQueue(error: unknown, token: string | null) {
  pendingQueue.forEach((p) => {
    if (error || !token) p.reject(error);
    else p.resolve(token);
  });
  pendingQueue = [];
}

/** Callbacks the auth store wires up at boot to keep this module store-agnostic. */
type AuthHooks = {
  onTokensRefreshed?: (tokens: AuthTokens) => void;
  onSignOut?: () => void;
};

const hooks: AuthHooks = {};

type ApiDiagnosticKind =
  | 'HTTP_ERROR'
  | 'TIMEOUT'
  | 'INVALID_LOCAL_API_URL'
  | 'CLEARTEXT_HTTP'
  | 'NETWORK_TRANSPORT_FAILURE'
  | 'UNKNOWN';

const SENSITIVE_DIAGNOSTIC_KEY = /password|token|authorization|cookie|secret/i;

function requestUrl(config?: AxiosRequestConfig): string {
  const configuredUrl = config?.url ?? '';
  const absoluteUrl = /^https?:\/\//i.test(configuredUrl)
    ? configuredUrl
    : `${String(config?.baseURL ?? env.API_URL).replace(/\/$/, '')}/${configuredUrl.replace(/^\//, '')}`;

  try {
    const parsed = new URL(absoluteUrl);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return absoluteUrl.split(/[?#]/, 1)[0];
  }
}

function redactDiagnosticValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[TRUNCATED]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.slice(0, 1_000);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map((item) => redactDiagnosticValue(item, depth + 1));
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      SENSITIVE_DIAGNOSTIC_KEY.test(key)
        ? '[REDACTED]'
        : redactDiagnosticValue(entry, depth + 1),
    ]),
  );
}

function classifyApiFailure(error: AxiosError<ApiError>): ApiDiagnosticKind {
  if (error.response) return 'HTTP_ERROR';
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT')
    return 'TIMEOUT';

  try {
    const target = new URL(requestUrl(error.config));
    if (['localhost', '127.0.0.1', '10.0.2.2'].includes(target.hostname)) {
      return 'INVALID_LOCAL_API_URL';
    }
    if (target.protocol === 'http:') return 'CLEARTEXT_HTTP';
  } catch {
    // The malformed target is still included in the diagnostic payload.
  }

  if (error.code === 'ERR_NETWORK') return 'NETWORK_TRANSPORT_FAILURE';
  return 'UNKNOWN';
}

function loginRedirectLocation(): string {
  const isCareInvitation =
    window.location.pathname === '/care/invitations/accept' &&
    /^#token=/.test(window.location.hash);
  return isCareInvitation ? `/login${window.location.hash}` : '/login';
}
function shouldLogApiDiagnostics(): boolean {
  return Capacitor.isNativePlatform() || env.ENABLE_DEVTOOLS;
}

function logApiFailure(error: AxiosError<ApiError>): void {
  if (!shouldLogApiDiagnostics()) return;

  console.error('[MediTrack API failure]', {
    kind: classifyApiFailure(error),
    requestUrl: requestUrl(error.config),
    method: error.config?.method?.toUpperCase() ?? 'UNKNOWN',
    statusCode: error.response?.status ?? null,
    responseBody: redactDiagnosticValue(error.response?.data),
    exceptionType: error.name,
    exceptionCode: error.code ?? null,
    message: error.message,
    stack: error.stack,
    deviceOnline: typeof navigator === 'undefined' ? null : navigator.onLine,
  });
}

export function configureAuthHooks(next: AuthHooks): void {
  hooks.onTokensRefreshed = next.onTokensRefreshed;
  hooks.onSignOut = next.onSignOut;
}

export const apiClient: AxiosInstance = axios.create({
  baseURL: env.API_URL,
  timeout: 15_000,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

export const api = apiClient;
export default apiClient;

// ── Request: attach token ────────────────────────────────────
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = storage.get<string>(StorageKeys.ACCESS_TOKEN);
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (shouldLogApiDiagnostics() && config.url?.includes('/auth/')) {
    console.info('[MediTrack API request]', {
      requestUrl: requestUrl(config),
      method: config.method?.toUpperCase() ?? 'GET',
    });
  }
  return config;
});

// ── Response: retry policy, refresh, and redirect ─────────────
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiError>) => {
    logApiFailure(error);
    const original = error.config as
      | (InternalAxiosRequestConfig & {
          _retry?: boolean;
          _retryCount?: number;
        })
      | undefined;

    if (!original) return Promise.reject(error);

    // 1. Retry policy: retry GET requests only, maximum 2 times for transient/network errors
    const isGet = original.method?.toUpperCase() === 'GET';
    const isTransientError =
      !error.response ||
      (error.response.status >= 500 && error.response.status < 600);

    if (isGet && isTransientError) {
      original._retryCount = original._retryCount ?? 0;
      if (original._retryCount < 2) {
        original._retryCount += 1;
        return apiClient(original);
      }
    }

    // 2. Authentication refresh and redirect unauthorized (401 Handler)
    const status = error.response?.status;
    const isAuthEndpoint =
      original.url?.includes('/auth/login') ||
      original.url?.includes('/auth/register') ||
      original.url?.includes('/auth/refresh');

    if (status === 401 && !original._retry && !isAuthEndpoint) {
      const user = storage.get<User>(StorageKeys.USER);
      const refreshToken = storage.get<string>(StorageKeys.REFRESH_TOKEN);

      if (!user || !refreshToken) {
        hooks.onSignOut?.();
        if (
          window.location.pathname !== '/login' &&
          window.location.pathname !== '/register'
        ) {
          window.location.href = loginRedirectLocation();
        }
        return Promise.reject(error);
      }

      original._retry = true;

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          pendingQueue.push({
            resolve: (token) => {
              if (original.headers)
                original.headers.Authorization = `Bearer ${token}`;
              resolve(apiClient(original));
            },
            reject,
          });
        });
      }

      isRefreshing = true;

      try {
        const { data: rawRefresh } = await axios.post<unknown>(
          `${env.API_URL}/auth/refresh`,
          { userId: user.id, refreshToken },
          { headers: { 'Content-Type': 'application/json' } },
        );

        // Unwrap the backend envelope { success, data, timestamp }
        const tokens = (
          rawRefresh !== null &&
          typeof rawRefresh === 'object' &&
          'data' in (rawRefresh as object)
            ? (rawRefresh as { data: AuthTokens }).data
            : rawRefresh
        ) as AuthTokens;

        storage.set(StorageKeys.ACCESS_TOKEN, tokens.accessToken);
        storage.set(StorageKeys.REFRESH_TOKEN, tokens.refreshToken);
        hooks.onTokensRefreshed?.(tokens);

        flushQueue(null, tokens.accessToken);

        if (original.headers)
          original.headers.Authorization = `Bearer ${tokens.accessToken}`;
        return apiClient(original);
      } catch (refreshErr) {
        flushQueue(refreshErr, null);
        hooks.onSignOut?.();
        if (
          window.location.pathname !== '/login' &&
          window.location.pathname !== '/register'
        ) {
          window.location.href = loginRedirectLocation();
        }
        return Promise.reject(refreshErr);
      } finally {
        isRefreshing = false;
      }
    }

    // Redirect unauthorized if refresh token fails or 401 on auth endpoints
    if (status === 401 && isAuthEndpoint) {
      hooks.onSignOut?.();
      if (
        window.location.pathname !== '/login' &&
        window.location.pathname !== '/register'
      ) {
        window.location.href = loginRedirectLocation();
      }
    }

    return Promise.reject(error);
  },
);

/* ─────────────────────────────────────────────────────────────
   Friendly error extractor — flattens validation arrays
   from class-validator into a single message.
   ───────────────────────────────────────────────────────────── */
export function extractErrorMessage(
  error: unknown,
  fallback = 'Something went wrong',
): string {
  if (axios.isAxiosError<ApiError>(error)) {
    const data = error.response?.data;
    if (data) {
      if (Array.isArray(data.message)) return data.message.join(' • ');
      if (typeof data.message === 'string') return data.message;
      if (typeof data.error === 'string') return data.error;
    }
    const kind = classifyApiFailure(error);
    if (kind === 'INVALID_LOCAL_API_URL') {
      return Capacitor.isNativePlatform()
        ? 'This app build is connected to a local development server. Install the latest Android build.'
        : 'The local API server could not be reached. Start the backend and try again.';
    }
    if (kind === 'CLEARTEXT_HTTP') {
      return 'The app blocked an insecure server connection. Install the latest secure build.';
    }
    if (kind === 'TIMEOUT') {
      return 'The medicine service took too long to respond. Please try again.';
    }
    if (kind === 'NETWORK_TRANSPORT_FAILURE') {
      return 'The medicine service could not be reached. Please try again shortly.';
    }
    return error.message || fallback;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

/* ─────────────────────────────────────────────────────────────
   Backend wraps every response in { success: true, data: T, timestamp }.
   Unwrap it transparently so all callers just get the typed payload.
   ───────────────────────────────────────────────────────────── */
function unwrap<T>(axiosData: unknown): T {
  // If the backend envelope is present, return the inner data field.
  if (
    axiosData !== null &&
    typeof axiosData === 'object' &&
    'data' in (axiosData as object) &&
    'success' in (axiosData as object)
  ) {
    return (axiosData as { data: T }).data;
  }
  return axiosData as T;
}

/** Tiny helper for typed GET/POST/PATCH/DELETE — keeps call sites concise. */
export const http = {
  get: <T>(url: string, config?: AxiosRequestConfig) =>
    apiClient.get<unknown>(url, config).then((r) => unwrap<T>(r.data)),
  post: <T, B = unknown>(url: string, body?: B, config?: AxiosRequestConfig) =>
    apiClient.post<unknown>(url, body, config).then((r) => unwrap<T>(r.data)),
  patch: <T, B = unknown>(url: string, body?: B, config?: AxiosRequestConfig) =>
    apiClient.patch<unknown>(url, body, config).then((r) => unwrap<T>(r.data)),
  put: <T, B = unknown>(url: string, body?: B, config?: AxiosRequestConfig) =>
    apiClient.put<unknown>(url, body, config).then((r) => unwrap<T>(r.data)),
  delete: <T>(url: string, config?: AxiosRequestConfig) =>
    apiClient.delete<unknown>(url, config).then((r) => unwrap<T>(r.data)),
};
