import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  LogOut,
  Settings as SettingsIcon,
  User as UserIcon,
} from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { useAuthStore, useUser } from '@/store/auth.store';
import { authService } from '@/services/auth.service';
import { ROUTES } from '@/constants/app';
import { notify } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import { AccountModeSwitcher } from '@/components/account/AccountModeSwitcher';

/** Avatar dropdown with profile/settings links and a secure sign-out. */
export function NavUserMenu() {
  const user = useUser();
  const signOut = useAuthStore((s) => s.signOut);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleSignOut = async () => {
    setSigningOut(true);
    // Best-effort server logout; always clear local session regardless of outcome
    // so the user is never left in a half-authenticated state.
    try {
      await authService.logout();
    } finally {
      signOut();
      notify.success('Signed out');
      navigate(ROUTES.LOGIN, { replace: true });
    }
  };

  const displayName = user?.fullName || user?.email || 'Account';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-xl p-1 pr-2 transition-colors hover:bg-surface-hover"
      >
        <Avatar
          name={user?.fullName ?? user?.email}
          src={user?.avatarUrl}
          size="sm"
        />
        <span className="hidden max-w-[140px] truncate text-sm font-medium text-text-primary sm:block">
          {displayName}
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 text-text-muted transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-64 overflow-hidden rounded-lg border border-border bg-bg-overlay p-1.5 shadow-elevated backdrop-blur-xl"
        >
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium text-text-primary">
              {displayName}
            </p>
            {user?.email && (
              <p className="truncate text-xs text-text-muted">{user.email}</p>
            )}
          </div>
          <div className="my-1 border-t border-border" />
          <div className="px-2 py-2">
            <p className="mb-2 text-xs font-medium text-text-muted">
              Account mode
            </p>
            <AccountModeSwitcher compact onSwitched={() => setOpen(false)} />
          </div>
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate('/profile');
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            <UserIcon className="h-4 w-4" /> Profile
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate(ROUTES.SETTINGS);
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            <SettingsIcon className="h-4 w-4" /> Settings
          </button>
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            role="menuitem"
            disabled={signingOut}
            onClick={handleSignOut}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-danger transition-colors hover:bg-danger-soft disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" />{' '}
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  );
}
