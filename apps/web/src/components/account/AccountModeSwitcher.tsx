import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { HeartHandshake, UserRound } from 'lucide-react';
import { authService } from '@/services/auth.service';
import { extractErrorMessage } from '@/lib/api-client';
import {
  homeRouteForRole,
  isSwitchableAccountRole,
} from '@/lib/role-navigation';
import { useAuthStore } from '@/store/auth.store';
import { notify } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import type { UserRole } from '@/types/auth';

interface AccountModeSwitcherProps {
  compact?: boolean;
  onSwitched?: () => void;
  redirectTo?: string;
}

const MODES: Array<{
  role: Extract<UserRole, 'PATIENT' | 'CAREGIVER'>;
  label: string;
  icon: typeof UserRound;
}> = [
  { role: 'PATIENT', label: 'Patient', icon: UserRound },
  { role: 'CAREGIVER', label: 'Caregiver', icon: HeartHandshake },
];

export function AccountModeSwitcher({
  compact = false,
  onSwitched,
  redirectTo,
}: AccountModeSwitcherProps) {
  const user = useAuthStore((state) => state.user);
  const setSession = useAuthStore((state) => state.setSession);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [switchingTo, setSwitchingTo] = useState<UserRole | null>(null);

  if (!isSwitchableAccountRole(user?.role)) return null;

  const switchMode = async (
    role: Extract<UserRole, 'PATIENT' | 'CAREGIVER'>,
  ) => {
    if (role === user.role || switchingTo) return;
    setSwitchingTo(role);
    try {
      const session = await authService.switchMode(role);
      queryClient.clear();
      setSession(session);
      onSwitched?.();
      navigate(redirectTo ?? homeRouteForRole(session.user.role), {
        replace: true,
      });
      notify.success(
        role === 'PATIENT'
          ? 'Switched to patient mode'
          : 'Switched to caregiver mode',
      );
    } catch (error) {
      notify.error(extractErrorMessage(error, 'Unable to switch account mode'));
    } finally {
      setSwitchingTo(null);
    }
  };

  return (
    <div>
      <div
        className={cn(
          'grid grid-cols-2 gap-1 rounded-lg border border-border bg-bg-inset p-1',
          compact ? 'w-full' : 'max-w-md',
        )}
        role="group"
        aria-label="Account mode"
      >
        {MODES.map((mode) => {
          const Icon = mode.icon;
          const active = user.role === mode.role;
          const loading = switchingTo === mode.role;
          return (
            <button
              key={mode.role}
              type="button"
              aria-pressed={active}
              disabled={Boolean(switchingTo)}
              onClick={() => void switchMode(mode.role)}
              className={cn(
                'flex min-h-10 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:cursor-wait disabled:opacity-70',
                active
                  ? 'bg-brand-500/15 text-brand-400 ring-1 ring-inset ring-brand-500/30'
                  : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{loading ? 'Switching...' : mode.label}</span>
            </button>
          );
        })}
      </div>
      {!compact && (
        <p className="mt-2 text-xs text-text-muted">
          Patient mode manages your own health. Caregiver mode shows only
          information another patient explicitly shared with you.
        </p>
      )}
    </div>
  );
}
