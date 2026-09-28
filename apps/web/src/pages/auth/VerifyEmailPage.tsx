import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { notify } from '@/components/ui/Toast';
import { ROUTES } from '@/constants/app';
import { extractErrorMessage } from '@/lib/api-client';
import { authService } from '@/services/auth.service';

interface LocationState {
  email?: string;
  deliveryStatus?: 'SENT' | 'FAILED';
  from?: { pathname: string; search?: string; hash?: string };
}

export default function VerifyEmailPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const started = useRef(false);
  const state = (location.state as LocationState | null) ?? {};
  const fragment = useMemo(
    () => new URLSearchParams(window.location.hash.replace(/^#/, '')),
    [],
  );
  const token = fragment.get('token') ?? '';
  const careInvite = fragment.get('careInvite') ?? '';
  const pendingCareInvite = useMemo(() => {
    if (careInvite) return careInvite;
    const fromFragment = new URLSearchParams(
      state.from?.hash?.replace(/^#/, '') ?? '',
    );
    return fromFragment.get('token') ?? '';
  }, [careInvite, state.from?.hash]);
  const [email, setEmail] = useState(state.email ?? '');

  const verify = useMutation({
    mutationFn: authService.verifyEmail,
    onSuccess: () => {
      window.history.replaceState(null, '', ROUTES.VERIFY_EMAIL);
      notify.success('Email verified successfully');
    },
  });
  const resend = useMutation({
    mutationFn: authService.resendEmailVerification,
    onSuccess: (result) => notify.success(result.message),
    onError: (error) =>
      notify.error(
        extractErrorMessage(error, 'Unable to resend verification email'),
      ),
  });

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    verify.mutate(token);
  }, [token, verify]);

  const continueToLogin = () => {
    const from = careInvite
      ? {
          pathname: ROUTES.CARE_INVITATION_ACCEPT,
          hash: `#token=${careInvite}`,
        }
      : state.from;
    navigate(ROUTES.LOGIN, {
      replace: true,
      state: from ? { from } : undefined,
    });
  };

  if (token) {
    return (
      <div className="text-center">
        <MailCheck className="mx-auto h-10 w-10 text-brand-400" />
        <h2 className="mt-4 text-lg font-semibold text-text-primary">
          {verify.isPending
            ? 'Verifying your email'
            : verify.isSuccess
              ? 'Email verified'
              : 'Verification failed'}
        </h2>
        <p className="mt-2 text-sm text-text-muted">
          {verify.isPending && 'Please wait while we validate the secure link.'}
          {verify.isSuccess &&
            'Your address is confirmed. Sign in to continue securely.'}
          {verify.isError &&
            extractErrorMessage(
              verify.error,
              'This verification link is invalid or expired.',
            )}
        </p>
        {verify.isSuccess && (
          <Button className="mt-6" fullWidth onClick={continueToLogin}>
            Continue to sign in
          </Button>
        )}
        {verify.isError && (
          <Button
            className="mt-6"
            fullWidth
            variant="secondary"
            onClick={() => navigate(ROUTES.VERIFY_EMAIL, { replace: true })}
          >
            Request another link
          </Button>
        )}
      </div>
    );
  }

  return (
    <div>
      {state.deliveryStatus === 'FAILED' ? (
        <AlertTriangle className="h-9 w-9 text-warning" />
      ) : (
        <MailCheck className="h-9 w-9 text-brand-400" />
      )}
      <h2 className="mt-4 text-lg font-semibold text-text-primary">
        {state.deliveryStatus === 'FAILED'
          ? 'Email delivery failed'
          : 'Check your email'}
      </h2>
      <p className="mt-2 text-sm text-text-muted">
        {state.deliveryStatus === 'FAILED'
          ? 'We could not send the verification link. Check the address and try again below.'
          : 'Open the single-use verification link we sent. It expires after 30 minutes.'}
      </p>

      <div className="mt-6 space-y-3">
        <Input
          label="Registration email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Button
          fullWidth
          variant="secondary"
          disabled={!email.trim()}
          isLoading={resend.isPending}
          onClick={() =>
            resend.mutate({
              email: email.trim().toLowerCase(),
              careInvitationToken: pendingCareInvite || undefined,
            })
          }
        >
          Resend verification email
        </Button>
      </div>

      <p className="mt-6 text-center text-sm text-text-muted">
        Already verified?{' '}
        <Link
          to={ROUTES.LOGIN}
          state={state.from ? { from: state.from } : undefined}
          className="font-medium text-brand-400 hover:text-brand-300"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
