import { useCallback, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { PRIMARY_NAV, SECONDARY_NAV, type NavItem } from './nav-items';
import { useUIStore } from '@/store/ui.store';
import { useAuthStore } from '@/store/auth.store';
import { APP_NAME } from '@/constants/app';
import { cn } from '@/lib/utils';

function MobileLink({ item, onNavigate }: { item: NavItem; onNavigate: (to: string) => void }) {
  const Icon = item.icon;
  const location = useLocation();
  const active = item.matchPrefix
    ? location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
    : location.pathname === item.to;

  return (
    <button
      type="button"
      onClick={() => onNavigate(item.to)}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-12 w-full touch-manipulation items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium transition-colors',
        active
          ? 'bg-brand-500/12 text-brand-400'
          : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
      )}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span className="truncate">{item.label}</span>
    </button>
  );
}

/** Slide-in navigation drawer for small screens. */
export function MobileSidebar() {
  const open = useUIStore((s) => s.mobileNavOpen);
  const setOpen = useUIStore((s) => s.setMobileNavOpen);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const navigate = useNavigate();
  const primaryNav = PRIMARY_NAV.filter((item) => !item.roles || (user && item.roles.includes(user.role)));
  const secondaryNav = SECONDARY_NAV.filter((item) => !item.roles || (user && item.roles.includes(user.role)));

  const close = useCallback(() => setOpen(false), [setOpen]);
  const closeImmediately = useCallback(() => {
    flushSync(() => setOpen(false));
  }, [setOpen]);

  const handleNavigate = useCallback(
    (to: string) => {
      closeImmediately();
      if (location.pathname !== to) {
        navigate(to);
      }
    },
    [closeImmediately, location.pathname, navigate],
  );

  // Close on route change, including browser back/forward navigation.
  useEffect(() => {
    close();
  }, [location.pathname, close]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
      <button
        type="button"
        aria-label="Close navigation overlay"
        onPointerDown={closeImmediately}
        onClick={close}
        className="absolute inset-0 z-0 cursor-default touch-manipulation bg-black/60 backdrop-blur-sm"
      />
      <aside className="absolute inset-y-0 left-0 z-10 flex w-72 max-w-[80%] flex-col border-r border-border bg-surface-solid shadow-2xl">
        <div className="flex h-16 items-center justify-between px-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-brand shadow-glow">
              <span className="text-lg" aria-hidden="true">&#128138;</span>
            </div>
            <span className="text-sm font-semibold text-text-primary">{APP_NAME}</span>
          </div>
          <button
            type="button"
            onPointerDown={(event) => {
              event.stopPropagation();
              closeImmediately();
            }}
            onClick={close}
            aria-label="Close navigation"
            className="relative z-20 flex h-11 w-11 touch-manipulation items-center justify-center rounded-lg text-text-muted hover:bg-surface-hover hover:text-text-primary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
          {primaryNav.map((item) => (
            <MobileLink key={item.to} item={item} onNavigate={handleNavigate} />
          ))}
          <div className="my-2 border-t border-border" />
          {secondaryNav.map((item) => (
            <MobileLink key={item.to} item={item} onNavigate={handleNavigate} />
          ))}
        </nav>
      </aside>
    </div>
  );
}
