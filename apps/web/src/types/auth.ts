export type UserRole = 'PATIENT' | 'CAREGIVER' | 'DOCTOR' | 'ADMIN';

export interface User {
  id: string;
  email: string;
  phone?: string | null;
  role: UserRole;
  isActive: boolean;
  isVerified?: boolean;
  createdAt?: string;
  lastLoginAt?: string | null;
  fullName?: string | null;
  avatarUrl?: string | null;
  geminiActive?: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthSession extends AuthTokens {
  user: User;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  email: string;
  password: string;
  phone?: string;
  role?: UserRole;
  careInvitationToken?: string;
}

export interface RegistrationResult {
  verificationRequired: true;
  email: string;
  deliveryStatus: 'SENT' | 'FAILED';
  message: string;
}

export interface EmailVerificationResult {
  verified: true;
  email: string;
  message: string;
}
