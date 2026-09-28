import { useMemo, useState } from 'react';
import {
  Link2,
  Pencil,
  ShieldCheck,
  Trash2,
  UserPlus,
  UsersRound,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { notify } from '@/components/ui/Toast';
import {
  useCareAccessLog,
  useCareActions,
  useCareCircle,
  useSupportedPeople,
} from '@/hooks/useCare';
import { extractErrorMessage } from '@/lib/api-client';
import { ROUTES } from '@/constants/app';
import { useUser } from '@/store/auth.store';
import type { CarePermission, CareRelationship } from '@/types/care';

const PERMISSIONS: Array<{
  value: CarePermission;
  label: string;
  description: string;
}> = [
  {
    value: 'VIEW_ADHERENCE',
    label: 'Adherence status',
    description:
      'Dose status and daily completion. Medicine names stay hidden unless separately shared.',
  },
  {
    value: 'VIEW_MEDICATIONS',
    label: 'Medicine list',
    description: 'Names, strengths, and forms of active medicines.',
  },
  {
    value: 'VIEW_MEDICATION_SAFETY',
    label: 'Medication safety',
    description:
      'Read-only access to shared safety findings and recorded allergies.',
  },
  {
    value: 'VIEW_REFILLS',
    label: 'Refill status',
    description: 'Current stock and whether a refill needs attention.',
  },
  {
    value: 'RECEIVE_MISSED_DOSE_ALERTS',
    label: 'Missed-dose alerts',
    description:
      'Privacy-safe app alerts without medicine or patient names on the lock screen.',
  },
  {
    value: 'RECEIVE_DOSE_HELP_REQUESTS',
    label: 'Dose help requests',
    description:
      'Privacy-safe check-in alerts when the patient explicitly asks for help with a dose.',
  },
];

function permissionLabel(permission: CarePermission) {
  return (
    PERMISSIONS.find((item) => item.value === permission)?.label ?? permission
  );
}

function formatDate(value: string | null) {
  if (!value) return 'No expiry';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
    new Date(value),
  );
}

export default function CareCirclePage() {
  const user = useUser();
  const isPatient = user?.role === 'PATIENT';
  const isCaregiver = user?.role === 'CAREGIVER';
  const circleQuery = useCareCircle(isPatient);
  const supportedQuery = useSupportedPeople(isCaregiver);
  const accessLogQuery = useCareAccessLog(isPatient);
  const actions = useCareActions();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [duration, setDuration] = useState('365');
  const [permissions, setPermissions] = useState<CarePermission[]>([
    'VIEW_ADHERENCE',
    'VIEW_MEDICATIONS',
    'VIEW_REFILLS',
  ]);
  const [confirmAdult, setConfirmAdult] = useState(false);
  const [consent, setConsent] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState<CareRelationship | null>(null);
  const [editingPermissions, setEditingPermissions] = useState<
    CarePermission[]
  >([]);
  const [revokeTarget, setRevokeTarget] = useState<{
    kind: 'relationship' | 'invitation';
    id: string;
    name: string;
  } | null>(null);

  const isLoading = isPatient
    ? circleQuery.isLoading || accessLogQuery.isLoading
    : supportedQuery.isLoading;
  const error = isPatient
    ? circleQuery.error || accessLogQuery.error
    : supportedQuery.error;
  const relationships = circleQuery.data?.relationships ?? [];
  const invitations = circleQuery.data?.invitations ?? [];
  const supported = supportedQuery.data ?? [];
  const accessLog = accessLogQuery.data ?? [];
  const canCreate =
    email.trim().length > 3 &&
    permissions.length > 0 &&
    confirmAdult &&
    consent;

  const togglePermission = (
    permission: CarePermission,
    selected: CarePermission[],
    update: (next: CarePermission[]) => void,
  ) => {
    update(
      selected.includes(permission)
        ? selected.filter((item) => item !== permission)
        : [...selected, permission],
    );
  };

  const resetInvite = () => {
    setInviteOpen(false);
    setEmail('');
    setDuration('365');
    setPermissions(['VIEW_ADHERENCE', 'VIEW_MEDICATIONS', 'VIEW_REFILLS']);
    setConfirmAdult(false);
    setConsent(false);
  };

  const createInvitation = async () => {
    try {
      const result = await actions.createInvitation.mutateAsync({
        email: email.trim().toLowerCase(),
        permissions,
        confirmAdult: true,
        consentAcknowledged: true,
        accessDurationDays: Number(duration),
      });
      setInviteUrl(result.inviteUrl);
      resetInvite();
      notify.success(
        result.delivery === 'EMAIL'
          ? 'Caregiver invitation emailed'
          : 'Invitation created. Copy and share the private link.',
      );
    } catch (error) {
      notify.error(extractErrorMessage(error, 'Unable to create invitation'));
    }
  };

  const copyInvite = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      notify.success('Private invitation link copied');
    } catch {
      notify.error('Unable to copy the link on this device');
    }
  };

  const savePermissions = async () => {
    if (!editing || !editingPermissions.length) return;
    try {
      await actions.updatePermissions.mutateAsync({
        id: editing.id,
        permissions: editingPermissions,
      });
      setEditing(null);
      notify.success('Caregiver permissions updated');
    } catch (error) {
      notify.error(extractErrorMessage(error, 'Unable to update permissions'));
    }
  };

  const revoke = async () => {
    if (!revokeTarget) return;
    try {
      if (revokeTarget.kind === 'relationship') {
        await actions.revokeRelationship.mutateAsync(revokeTarget.id);
        notify.success('Caregiver access revoked immediately');
      } else {
        await actions.revokeInvitation.mutateAsync(revokeTarget.id);
        notify.success('Invitation revoked');
      }
      setRevokeTarget(null);
    } catch (error) {
      notify.error(extractErrorMessage(error, 'Unable to revoke access'));
    }
  };

  const sections = useMemo(
    () =>
      isPatient
        ? [
            { count: relationships.length, label: 'People with access' },
            { count: invitations.length, label: 'Pending invitations' },
          ]
        : [{ count: supported.length, label: 'People I support' }],
    [isPatient, relationships.length, invitations.length, supported.length],
  );

  if (isLoading) {
    return (
      <div className="flex min-h-80 items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Care Circle"
        description={
          isPatient
            ? 'Share only the medication information you choose, for a limited time.'
            : 'View only the information patients explicitly shared with you.'
        }
        actions={
          isPatient ? (
            <Button
              leftIcon={<UserPlus className="h-4 w-4" />}
              onClick={() => setInviteOpen(true)}
            >
              Invite caregiver
            </Button>
          ) : undefined
        }
      />

      {error && (
        <div className="mb-5 rounded-lg border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
          {extractErrorMessage(error, 'Unable to load your care circle')}
        </div>
      )}

      <div
        className={`mb-6 grid grid-cols-1 border border-border ${
          isPatient ? 'sm:grid-cols-2' : ''
        }`}
      >
        {sections.map((section) => (
          <div
            key={section.label}
            className="border-b border-border p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
          >
            <div className="text-2xl font-semibold text-text-primary">
              {section.count}
            </div>
            <div className="text-sm text-text-muted">{section.label}</div>
          </div>
        ))}
      </div>

      {isPatient && (
        <>
          <section className="mb-8">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-text-primary">
                People with access
              </h2>
              <span className="text-xs text-text-muted">
                You can change or revoke access at any time
              </span>
            </div>
            {relationships.length ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {relationships.map((relationship) => (
                  <Card key={relationship.id} className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="font-semibold text-text-primary">
                          {relationship.caregiver?.displayName}
                        </h3>
                        <p className="mt-1 text-xs text-text-muted">
                          Access expires {formatDate(relationship.expiresAt)}
                        </p>
                      </div>
                      <Badge tone="success" dot>
                        Active
                      </Badge>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {relationship.permissions.map((permission) => (
                        <Badge key={permission}>
                          {permissionLabel(permission)}
                        </Badge>
                      ))}
                    </div>
                    <div className="mt-5 flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        leftIcon={<Pencil className="h-3.5 w-3.5" />}
                        onClick={() => {
                          setEditing(relationship);
                          setEditingPermissions(relationship.permissions);
                        }}
                      >
                        Permissions
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-danger"
                        leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                        onClick={() =>
                          setRevokeTarget({
                            kind: 'relationship',
                            id: relationship.id,
                            name:
                              relationship.caregiver?.displayName ??
                              'this caregiver',
                          })
                        }
                      >
                        Revoke
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<UsersRound className="h-6 w-6" />}
                title="No caregiver access"
                description="Only you can see your medication information until you invite and approve someone."
              />
            )}
          </section>

          {invitations.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-3 text-base font-semibold text-text-primary">
                Pending invitations
              </h2>
              <div className="divide-y divide-border border border-border">
                {invitations.map((invitation) => (
                  <div
                    key={invitation.id}
                    className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <div className="font-medium text-text-primary">
                        {invitation.invitedEmail}
                      </div>
                      <div className="text-xs text-text-muted">
                        Invite expires {formatDate(invitation.expiresAt)}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="self-start text-danger sm:self-auto"
                      onClick={() =>
                        setRevokeTarget({
                          kind: 'invitation',
                          id: invitation.id,
                          name: invitation.invitedEmail,
                        })
                      }
                    >
                      Revoke invite
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {isCaregiver && (
        <section className="mb-8">
          <h2 className="mb-3 text-base font-semibold text-text-primary">
            People I support
          </h2>
          {supported.length ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {supported.map((relationship) => (
                <Card key={relationship.id} className="p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h3 className="font-semibold text-text-primary">
                        {relationship.patient?.displayName}
                      </h3>
                      <p className="mt-1 text-xs text-text-muted">
                        Shared until {formatDate(relationship.expiresAt)}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        window.location.assign(
                          ROUTES.CARE_PATIENT(relationship.patient!.id),
                        )
                      }
                    >
                      View shared status
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <p className="border border-dashed border-border p-5 text-sm text-text-muted">
              No one has shared caregiver access with this account.
            </p>
          )}
        </section>
      )}

      {isPatient && (
        <section>
          <h2 className="mb-3 text-base font-semibold text-text-primary">
            Recent access history
          </h2>
          {accessLog.length ? (
            <div className="divide-y divide-border border border-border">
              {accessLog.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-4 p-4 text-sm"
                >
                  <span className="text-text-primary">
                    {entry.caregiver.displayName} viewed shared status
                  </span>
                  <time className="text-xs text-text-muted">
                    {new Date(entry.accessedAt).toLocaleString()}
                  </time>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-muted">
              No caregiver dashboard access has been recorded.
            </p>
          )}
        </section>
      )}

      {isPatient && (
        <>
          <Modal
            open={inviteOpen}
            onClose={resetInvite}
            title="Invite a caregiver"
            description="Invite any valid email. New caregivers can create and verify an account before accepting."
            footer={
              <>
                <Button variant="secondary" onClick={resetInvite}>
                  Cancel
                </Button>
                <Button
                  disabled={!canCreate}
                  isLoading={actions.createInvitation.isPending}
                  onClick={createInvitation}
                >
                  Send invitation
                </Button>
              </>
            }
          >
            <div className="space-y-5">
              <Input
                label="Caregiver email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
              />
              <Select
                label="Access duration"
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
                options={[
                  { value: '30', label: '30 days' },
                  { value: '90', label: '90 days' },
                  { value: '180', label: '180 days' },
                  { value: '365', label: '1 year' },
                ]}
              />
              <fieldset className="space-y-3">
                <legend className="mb-2 text-sm font-medium text-text-primary">
                  What can this person access?
                </legend>
                {PERMISSIONS.map((permission) => (
                  <Checkbox
                    key={permission.value}
                    checked={permissions.includes(permission.value)}
                    onChange={() =>
                      togglePermission(
                        permission.value,
                        permissions,
                        setPermissions,
                      )
                    }
                    label={permission.label}
                    description={permission.description}
                  />
                ))}
              </fieldset>
              <div className="space-y-3 border-t border-border pt-4">
                <Checkbox
                  checked={confirmAdult}
                  onChange={(event) => setConfirmAdult(event.target.checked)}
                  label="I confirm this is my own adult account"
                  description="Access for a minor requires a verified guardian process and is not supported in this version."
                />
                <Checkbox
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                  label="I consent to share the selected information"
                  description="I understand I can change permissions or revoke access at any time."
                />
              </div>
            </div>
          </Modal>

          <Modal
            open={Boolean(inviteUrl)}
            onClose={() => setInviteUrl(null)}
            title="Private invitation ready"
            description="This link is shown once and expires in 7 days. Send it only to the intended caregiver."
            footer={
              <Button
                onClick={copyInvite}
                leftIcon={<Link2 className="h-4 w-4" />}
              >
                Copy link
              </Button>
            }
          >
            <div className="break-all rounded-lg border border-border bg-bg-inset p-3 text-xs text-text-secondary">
              {inviteUrl}
            </div>
          </Modal>

          <Modal
            open={Boolean(editing)}
            onClose={() => setEditing(null)}
            title="Change shared access"
            description={`Changes apply immediately for ${editing?.caregiver?.displayName ?? 'this caregiver'}.`}
            footer={
              <>
                <Button variant="secondary" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button
                  disabled={!editingPermissions.length}
                  isLoading={actions.updatePermissions.isPending}
                  onClick={savePermissions}
                >
                  Save permissions
                </Button>
              </>
            }
          >
            <div className="space-y-3">
              {PERMISSIONS.map((permission) => (
                <Checkbox
                  key={permission.value}
                  checked={editingPermissions.includes(permission.value)}
                  onChange={() =>
                    togglePermission(
                      permission.value,
                      editingPermissions,
                      setEditingPermissions,
                    )
                  }
                  label={permission.label}
                  description={permission.description}
                />
              ))}
            </div>
          </Modal>

          <ConfirmDialog
            open={Boolean(revokeTarget)}
            onClose={() => setRevokeTarget(null)}
            title={
              revokeTarget?.kind === 'relationship'
                ? 'Revoke caregiver access?'
                : 'Revoke invitation?'
            }
            description={
              revokeTarget?.kind === 'relationship'
                ? `${revokeTarget.name} will immediately lose access to all shared medication information and future alerts.`
                : `${revokeTarget?.name} will no longer be able to accept this link.`
            }
            confirmLabel="Revoke"
            destructive
            isLoading={
              actions.revokeRelationship.isPending ||
              actions.revokeInvitation.isPending
            }
            onConfirm={revoke}
          />
        </>
      )}

      <div className="mt-8 flex items-start gap-3 rounded-lg border border-info/25 bg-info-soft p-4 text-sm text-text-secondary">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-info" />
        <p>
          Care Circle supports coordination only. It is not emergency
          monitoring, medical advice, or authority to change treatment.
        </p>
      </div>
    </div>
  );
}
