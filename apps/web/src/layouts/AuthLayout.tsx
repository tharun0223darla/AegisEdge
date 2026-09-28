import { Outlet } from 'react-router-dom';
import { motion } from 'framer-motion';
import { APP_NAME, APP_TAGLINE } from '@/constants/app';

export function AuthLayout() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-bg-base bg-gradient-mesh">
      <div className="pointer-events-none absolute inset-0 bg-gradient-radial" />
      <div className="relative flex min-h-screen items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-md"
        >
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-brand shadow-glow">
              <span className="text-2xl">💊</span>
            </div>

            <h1 className="text-2xl font-bold tracking-tight text-text-primary">
              {APP_NAME}
            </h1>

            <p className="mt-1 text-sm text-text-muted">
              {APP_TAGLINE}
            </p>
          </div>

          <div className="rounded-4xl border border-border bg-surface p-8 shadow-elevated backdrop-blur-xl">
            <Outlet />
          </div>
        </motion.div>
      </div>
    </div>
  );
}
