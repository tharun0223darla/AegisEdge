import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { AnimatePresence, motion } from 'framer-motion';
import { Sidebar } from '@/components/navigation/Sidebar';
import { MobileSidebar } from '@/components/navigation/MobileSidebar';
import { TopNavbar } from '@/components/navigation/TopNavbar';
import { useUIStore } from '@/store/ui.store';
import { syncCurrentDeviceDoseReminders } from '@/lib/local-reminders';
import { flushDoseActionQueue } from '@/lib/dose-action-queue';
import { useAuthStore } from '@/store/auth.store';
import { cn } from '@/lib/utils';

export function DashboardLayout() {
  const location = useLocation();
  const sidebarCollapsed = useUIStore((state) => state.sidebarCollapsed);
  const userId = useAuthStore((state) => state.user?.id);

  useEffect(() => {
    if (!userId) return;
    const flush = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      void flushDoseActionQueue(userId).catch((error) => {
        console.warn('Offline dose action sync failed', error);
      });
    };
    flush();
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('online', flush);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('online', flush);
    };
  }, [userId]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const syncReminders = () => {
      if (document.visibilityState !== 'visible') return;
      void syncCurrentDeviceDoseReminders().catch((error) => {
        console.warn('Automatic device reminder sync failed', error);
      });
    };

    syncReminders();
    document.addEventListener('visibilitychange', syncReminders);
    window.addEventListener('online', syncReminders);
    return () => {
      document.removeEventListener('visibilitychange', syncReminders);
      window.removeEventListener('online', syncReminders);
    };
  }, []);

  return (
    <div className="min-h-screen bg-bg-base bg-gradient-mesh text-text-primary">
      <Sidebar />
      <MobileSidebar />

      <div
        className={cn(
          'flex min-h-screen flex-col transition-[padding] duration-300 ease-out-expo',
          sidebarCollapsed ? 'lg:pl-20' : 'lg:pl-64',
        )}
      >
        <TopNavbar />

        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="mx-auto w-full max-w-7xl"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
