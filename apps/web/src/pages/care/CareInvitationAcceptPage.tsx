import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Navigate, useNavigate } from 'react-router-dom';
import { ShieldCheck, UsersRound } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { Spinner } from '@/components/ui/Spinner';
import { notify } from '@/components/ui/Toast';
import { AccountModeSwitcher } from '@/components/account/AccountModeSwitcher';
import { ROUTES } from '@/constants/app';
import { extractErrorMessage } from '@/lib/api-client';
import { careService } from '@/services/care.service';
import { useUser } from '@/store/auth.store';
import type { CarePermission } from '@/types/care';

const permissionNames: Record<CarePermission, string> = {
  VIEW_ADHERENCE: 'Adherence and dose status',
  VIEW_MEDICATIONS: 'Active medicine names and strengths',
  VIEW_MEDICATION_SAFETY: 'Medication safety findings and recorded allergies',
  VIEW_REFILLS: 'Stock and refill status',
  RECEIVE_MISSED_DOSE_ALERTS: 'Privacy-safe missed-dose alerts',
  RECEIVE_DOSE_HELP_REQUESTS: 'Privacy-safe dose help requests',
};

export default function CareInvitationAcceptPage() {
  const navigate = useNavigate();
  const user = useUser();
  const [acknowledged, setAcknowledged] = useState(false);
  const token = useMemo(
    () => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '',
    [],
  );
  const preview = useQuery({
    queryKey: ['care', 'invitation-preview', token ? 'present' : 'missing'],
    queryFn: () => careService.previewInvitation(token),
    enabled: Boolean(token) && user?.role === 'CAREGIVER',
    retry: false,
  });
  const accept = useMutation({
    mutationFn: () => careService.acceptInvitation(token),
    onSuccess: () => {
      window.history.replaceState(null, '', ROUTES.CARE);
      notify.success('Caregiver access accepted');
      navigate(ROUTES.CARE, { replace: true });
    },
    onError: (error) =>
      notify.error(extractErrorMessage(error, 'Unable to accept invitation')),
  });

  if (!token) return <Navigate to={ROUTES.CARE} replace />;
  if (user?.role === 'PATIENT') {
    return (
      <div className="mx-auto max-w-lg py-12">
        <Card className="p-6">
          <h1 className="text-lg font-semibold text-text-primary">
            Open in caregiver mode
          </h1>
          <p className="mt-2 text-sm text-text-muted">
            This invitation grants caregiver access. Switch modes to review it;
            your patient medicines and schedules remain unchanged.
          </p>
          <div className="mt-5">
            <AccountModeSwitcher
              redirectTo={`${ROUTES.CARE_INVITATION_ACCEPT}#token=${encodeURIComponent(token)}`}
            />
          </div>
        </Card>
      </div>
    );
  }
  if (preview.isLoading) {
    return (
      <div className="flex min-h-80 items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (preview.error || !preview.data) {
    return (
      <div className="mx-auto max-w-lg py-12">
        <Card className="p-6 text-center">
          <h1 className="text-lg font-semibold text-text-primary">
            Invitation unavailable
          </h1>
          <p className="mt-2 text-sm text-text-muted">
            {extractErrorMessage(
              preview.error,
              'This invitation is invalid, expired, or belongs to another account.',
            )}
          </p>
          <Button
            className="mt-5"
            onClick={() => navigate(ROUTES.CARE, { replace: true })}
          >
            Open Care Circle
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl py-8">
      <Card className="p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-400">
            <UsersRound className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-text-primary">
              Caregiver invitation
            </h1>
            <p className="mt-1 text-sm text-text-muted">
              {preview.data.patient.displayName} is asking you to help monitor
              selected medication information.
            </p>
          </div>
        </div>

        <div className="mt-6 border-y border-border py-5">
          <h2 className="text-sm font-semibold text-text-primary">
            Information they chose to share
          </h2>
          <ul className="mt-3 space-y-2 text-sm text-text-secondary">
            {preview.data.permissions.map((permission) => (
              <li key={permission} className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-success" />
                {permissionNames[permission]}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-text-muted">
            Access ends{' '}
            {new Date(preview.data.accessExpiresAt).toLocaleDateString()} and
            may be revoked sooner by the patient.
          </p>
        </div>

        <div className="mt-5 rounded-lg border border-warning/25 bg-warning-soft p-4 text-sm text-text-secondary">
          This access supports personal coordination only. It is not emergency
          monitoring, a diagnosis, or permission to change medicines or doses.
        </div>

        <Checkbox
          className="mt-5"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
          label="I accept the caregiver privacy responsibilities"
          description="I will use this information only to support this person and will not share it with others."
        />

        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => navigate(ROUTES.CARE)}>
            Decline
          </Button>
          <Button
            disabled={!acknowledged}
            isLoading={accept.isPending}
            onClick={() => accept.mutate()}
          >
            Accept access
          </Button>
        </div>
      </Card>
    </div>
  );
}
