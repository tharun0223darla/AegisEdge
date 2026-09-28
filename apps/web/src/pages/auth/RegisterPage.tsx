import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Eye, EyeOff, Lock, Mail, Phone } from 'lucide-react';
import {
  registerSchema,
  type RegisterFormValues,
} from '@/validation/auth.schema';
import { authService } from '@/services/auth.service';
import { extractErrorMessage } from '@/lib/api-client';
import { ROUTES } from '@/constants/app';
import type { RegisterPayload } from '@/types/auth';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { notify } from '@/components/ui/Toast';

const ROLE_OPTIONS = [
  { value: 'PATIENT', label: 'Patient - manage my medicines' },
  { value: 'CAREGIVER', label: 'Caregiver - support someone else' },
];

interface LocationState {
  from?: { pathname: string; search?: string; hash?: string };
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const from = (location.state as LocationState | null)?.from;
  const careInvitationToken =
    from?.pathname === ROUTES.CARE_INVITATION_ACCEPT
      ? (new URLSearchParams((from.hash ?? '').replace(/^#/, '')).get(
          'token',
        ) ?? undefined)
      : undefined;

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: '',
      phone: '',
      password: '',
      confirmPassword: '',
      role: careInvitationToken ? 'CAREGIVER' : 'PATIENT',
    },
  });

  const mutation = useMutation({
    mutationFn: (values: RegisterFormValues) => {
      // Strip confirmPassword — not part of the API contract.
      const payload: RegisterPayload = {
        email: values.email,
        password: values.password,
        role: values.role,
        ...(values.phone ? { phone: values.phone } : {}),
        ...(careInvitationToken ? { careInvitationToken } : {}),
      };
      return authService.register(payload);
    },
    onSuccess: (result, values) => {
      notify.success(result.message);
      navigate(ROUTES.VERIFY_EMAIL, {
        replace: true,
        state: {
          email: values.email.trim().toLowerCase(),
          deliveryStatus: result.deliveryStatus,
          from,
        },
      });
    },
    onError: (error) => {
      const message = extractErrorMessage(error, 'Unable to create account');
      setError('email', { message });
      notify.error(message);
    },
  });

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-text-primary">
          Create your account
        </h2>
        <p className="mt-1 text-sm text-text-muted">
          Start tracking your medication in minutes.
        </p>
      </div>

      <form
        onSubmit={handleSubmit((v) => mutation.mutate(v))}
        className="flex flex-col gap-4"
        noValidate
      >
        <Input
          type="email"
          label="Email"
          placeholder="you@example.com"
          autoComplete="email"
          leftIcon={<Mail className="h-4 w-4" />}
          error={errors.email?.message}
          {...register('email')}
        />

        <Input
          type="tel"
          label="Phone (optional)"
          placeholder="+14155552671"
          autoComplete="tel"
          leftIcon={<Phone className="h-4 w-4" />}
          hint="E.164 format, e.g. +14155552671"
          error={errors.phone?.message}
          {...register('phone')}
        />

        <Select
          label="I am a"
          options={ROLE_OPTIONS}
          error={errors.role?.message}
          {...register('role')}
        />
        {careInvitationToken && (
          <p className="rounded-lg border border-info/25 bg-info-soft p-3 text-xs text-text-secondary">
            You are registering from a private caregiver invitation. Access is
            granted only after this email is verified and you accept the
            patient&apos;s selected permissions.
          </p>
        )}

        <Input
          type={showPassword ? 'text' : 'password'}
          label="Password"
          placeholder="At least 8 characters"
          autoComplete="new-password"
          leftIcon={<Lock className="h-4 w-4" />}
          rightIcon={
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="pointer-events-auto text-text-muted transition-colors hover:text-text-primary"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          }
          error={errors.password?.message}
          {...register('password')}
        />

        <Input
          type={showPassword ? 'text' : 'password'}
          label="Confirm password"
          placeholder="Re-enter your password"
          autoComplete="new-password"
          leftIcon={<Lock className="h-4 w-4" />}
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />

        <Button type="submit" fullWidth isLoading={mutation.isPending}>
          Create account
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-text-muted">
        Already have an account?{' '}
        <Link
          to={ROUTES.LOGIN}
          className="font-medium text-brand-400 hover:text-brand-300"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
