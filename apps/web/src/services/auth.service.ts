import { http } from '@/lib/api-client';
import type {
  AuthSession,
  AuthTokens,
  LoginPayload,
  RegisterPayload,
  RegistrationResult,
  EmailVerificationResult,
  User,
} from '@/types/auth';

// Free/demo API hosts may need time to wake. Auth writes are deliberately not
// retried because replaying registration could create an ambiguous outcome.
const AUTH_REQUEST_TIMEOUT_MS = 90_000;

/** Auth API surface. Endpoints mirror api-server `auth.controller.ts`. */
export const authService = {
  login: (payload: LoginPayload) =>
    http.post<AuthSession, LoginPayload>('/auth/login', payload, {
      timeout: AUTH_REQUEST_TIMEOUT_MS,
    }),

  register: (payload: RegisterPayload) =>
    http.post<RegistrationResult, RegisterPayload>('/auth/register', payload, {
      timeout: AUTH_REQUEST_TIMEOUT_MS,
    }),

  verifyEmail: (token: string) =>
    http.post<EmailVerificationResult>(
      '/auth/verify-email',
      { token },
      {
        timeout: AUTH_REQUEST_TIMEOUT_MS,
      },
    ),

  resendEmailVerification: (payload: {
    email: string;
    careInvitationToken?: string;
  }) =>
    http.post<{ accepted: true; message: string }>(
      '/auth/resend-email-verification',
      payload,
      { timeout: AUTH_REQUEST_TIMEOUT_MS },
    ),

  refresh: (userId: string, refreshToken: string) =>
    http.post<AuthTokens>('/auth/refresh', { userId, refreshToken }),

  me: () => http.get<User>('/auth/me'),

  switchMode: (role: 'PATIENT' | 'CAREGIVER') =>
    http.patch<AuthSession, { role: 'PATIENT' | 'CAREGIVER' }>('/auth/mode', {
      role,
    }),

  logout: () =>
    // Best-effort — backend may or may not implement this.
    http
      .post<{ success: true }>('/auth/logout')
      .catch(() => ({ success: true as const })),
};
