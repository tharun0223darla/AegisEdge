import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Menu, Bell, Sparkles, Compass, ShieldCheck } from 'lucide-react';
import { ALL_NAV } from './nav-items';
import { NavUserMenu } from './NavUserMenu';
import { GlobalAiNavigatorModal } from './GlobalAiNavigatorModal';
import { useUIStore } from '@/store/ui.store';
import { notificationsService } from '@/services/notifications.service';
import { ROUTES } from '@/constants/app';
import { cn } from '@/lib/utils';
import { StripVerificationModal } from '@/components/doseLogs/StripVerificationModal';

function useCurrentTitle() {
  const { pathname } = useLocation();
  const match = ALL_NAV.find(
    (item) => pathname === item.to || (item.to !== '/' && pathname.startsWith(item.to + '/')),
  );
  return match?.label ?? '';
}

/** Sticky top bar: mobile menu trigger, page title, AI Help Guide, notifications, user menu. */
export function TopNavbar() {
  const setMobileNavOpen = useUIStore((s) => s.setMobileNavOpen);
  const title = useCurrentTitle();
  const [isAiGuideOpen, setIsAiGuideOpen] = useState(false);
  const [isVerifyStripOpen, setIsVerifyStripOpen] = useState(false);

  const { data: unread } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => notificationsService.unreadCount(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const count = unread?.count ?? 0;

  return (
    <>
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-surface/80 px-4 backdrop-blur-xl sm:px-6">
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open navigation"
          className="rounded-lg p-2 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>

        {title && <h1 className="text-base font-semibold text-text-primary">{title}</h1>}

        <div className="ml-auto flex items-center gap-2.5">
          {/* Prominent Global AI Help & Navigator Button */}
          <button
            type="button"
            onClick={() => setIsAiGuideOpen(true)}
            className="group relative flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-600 via-rose-600 to-indigo-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-md shadow-brand-500/20 hover:brightness-110 active:scale-95 transition-all"
            title="Ask AI or Explore App Routes"
          >
            <Sparkles className="h-4 w-4 animate-pulse" />
            <span className="hidden sm:inline">AI Help & Guide</span>
            <span className="inline sm:hidden">AI Guide</span>
            <span className="flex h-1.5 w-1.5 rounded-full bg-white animate-ping" />
          </button>

          {/* Notification Bell */}
          <Link
            to={ROUTES.NOTIFICATIONS}
            aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
            className="relative rounded-lg p-2 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            <Bell className="h-5 w-5" />
            {count > 0 && (
              <span
                className={cn(
                  'absolute -right-0.5 -top-0.5 flex min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-[18px] text-text-inverse',
                )}
              >
                {count > 99 ? '99+' : count}
              </span>
            )}
          </Link>

          {/* Always-Visible Strip Verifier Button */}
          <button
            type="button"
            onClick={() => setIsVerifyStripOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 px-3 py-1.5 text-xs font-bold text-emerald-400 transition-all shadow-sm cursor-pointer"
            title="Scan Medicine Blister Strip with Laptop Camera"
          >
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <span className="hidden sm:inline">Verify Strip</span>
          </button>

          <NavUserMenu />
        </div>
      </header>

      {/* Global AI Navigator & Clinical Tour Modal */}
      <GlobalAiNavigatorModal
        isOpen={isAiGuideOpen}
        onClose={() => setIsAiGuideOpen(false)}
      />

      {/* Standalone Point-of-Care Blister Strip Verification Modal */}
      <StripVerificationModal
        open={isVerifyStripOpen}
        onClose={() => setIsVerifyStripOpen(false)}
      />
    </>
  );
}
