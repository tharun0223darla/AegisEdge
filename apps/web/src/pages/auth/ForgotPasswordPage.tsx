import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Mail } from 'lucide-react';
import {
  forgotPasswordSchema,
  type ForgotPasswordFormValues,
} from '@/validation/auth.schema';
import { ROUTES } from '@/constants/app';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { notify } from '@/components/ui/Toast';

export default function ForgotPasswordPage() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isSubmitSuccessful },
  } = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  // NOTE: the backend does not expose a password-reset endpoint yet.
  // We intentionally do not fake a network call. When the endpoint lands,
  // wire authService.requestPasswordReset(values.email) here.
  const onSubmit = handleSubmit(async () => {
    notify.message('Password reset is not available yet. Please contact support.');
  });

  if (isSubmitSuccessful) {
    return (
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-500/12 text-brand-400">
          <Mail className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-semibold text-text-primary">Check your inbox</h2>
        <p className="mt-2 text-sm text-text-muted">
          If an account exists for that email, you&apos;ll receive reset instructions shortly.
        </p>
        <Link to={ROUTES.LOGIN} className="mt-6 inline-block">
          <Button variant="secondary" leftIcon={<ArrowLeft className="h-4 w-4" />}>
            Back to sign in
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-text-primary">Reset your password</h2>
        <p className="mt-1 text-sm text-text-muted">
          Enter your email and we&apos;ll send you instructions to reset it.
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Input
          type="email"
          label="Email"
          placeholder="you@example.com"
          autoComplete="email"
          leftIcon={<Mail className="h-4 w-4" />}
          error={errors.email?.message}
          {...register('email')}
        />

        <Button type="submit" fullWidth isLoading={isSubmitting}>
          Send reset link
        </Button>
      </form>

      <Link
        to={ROUTES.LOGIN}
        className="mt-6 flex items-center justify-center gap-1.5 text-sm font-medium text-brand-400 hover:text-brand-300"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to sign in
      </Link>
    </div>
  );
}
