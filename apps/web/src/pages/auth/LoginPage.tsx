import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { loginSchema, type LoginFormValues } from '@/validation/auth.schema';
import { authService } from '@/services/auth.service';
import { useAuthStore } from '@/store/auth.store';
import { extractErrorMessage } from '@/lib/api-client';
import { ROUTES } from '@/constants/app';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { notify } from '@/components/ui/Toast';
import { homeRouteForRole } from '@/lib/role-navigation';

interface LocationState {
  from?: { pathname: string; search?: string; hash?: string };
}

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useAuthStore((s) => s.setSession);
  const signOut = useAuthStore((s) => s.signOut);
  const [showPassword, setShowPassword] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState('');

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const from = (location.state as LocationState | null)?.from;
  const pendingCareInvite = /^#token=/.test(location.hash)
    ? `${ROUTES.CARE_INVITATION_ACCEPT}${location.hash}`
    : null;
  const requestedRedirect = from
    ? `${from.pathname}${from.search ?? ''}${from.hash ?? ''}`
    : pendingCareInvite;

  const mutation = useMutation({
    mutationFn: (values: LoginFormValues) => authService.login(values),
    onSuccess: async (session) => {
      setSession(session);
      try {
        await authService.me();
      } catch (error) {
        signOut();
        const message = extractErrorMessage(
          error,
          'Signed in, but the deployed API rejected the session. Check API URL and allowed frontend origin.',
        );
        setError('password', { message });
        notify.error(message);
        return;
      }
      notify.success('Welcome back!');
      navigate(requestedRedirect ?? homeRouteForRole(session.user.role), {
        replace: true,
      });
    },
    onError: (error, values) => {
      const message = extractErrorMessage(error, 'Unable to sign in');
      if (message.toLowerCase().includes('verify your email')) {
        setVerificationEmail(values.email.trim().toLowerCase());
      }
      setError('password', { message });
      notify.error(message);
    },
  });

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-text-primary">Sign in</h2>
        <p className="mt-1 text-sm text-text-muted">
          Welcome back. Enter your details to continue.
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
          type={showPassword ? 'text' : 'password'}
          label="Password"
          placeholder="••••••••"
          autoComplete="current-password"
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

        <div className="flex justify-end">
          <Link
            to="/forgot-password"
            className="text-xs font-medium text-brand-400 transition-colors hover:text-brand-300"
          >
            Forgot password?
          </Link>
        </div>

        <Button type="submit" fullWidth isLoading={mutation.isPending}>
          Sign in
        </Button>
        {verificationEmail && (
          <Link
            to={ROUTES.VERIFY_EMAIL}
            state={{ email: verificationEmail, from }}
            className="text-center text-sm font-medium text-brand-400 hover:text-brand-300"
          >
            Resend verification email
          </Link>
        )}
      </form>

      <p className="mt-6 text-center text-sm text-text-muted">
        Don&apos;t have an account?{' '}
        <Link
          to={ROUTES.REGISTER}
          state={from ? { from } : undefined}
          className="font-medium text-brand-400 hover:text-brand-300"
        >
          Create one
        </Link>
      </p>
    </div>
  );
}
