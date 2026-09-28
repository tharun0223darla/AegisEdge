import { useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { authService } from '@/services/auth.service';
import { useAuthStore } from '@/store/auth.store';
import { LoadingScreen } from '@/components/shared/LoadingScreen';

export function AuthProvider({ children }: PropsWithChildren) {
  const initialize = useAuthStore((s) => s.initialize);
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const updateUser = useAuthStore((s) => s.updateUser);
  const started = useRef(false);
  const verificationStarted = useRef(false);
  const [isSessionChecked, setIsSessionChecked] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    initialize();
  }, [initialize]);

  useEffect(() => {
    if (!isInitialized || verificationStarted.current) return;
    verificationStarted.current = true;

    if (!isAuthenticated) {
      setIsSessionChecked(true);
      return;
    }

    void authService
      .me()
      .then((user) => updateUser(user))
      .finally(() => setIsSessionChecked(true));
  }, [isAuthenticated, isInitialized, updateUser]);

  if (!isInitialized || !isSessionChecked) {
    return <LoadingScreen label="Verifying MediTrack session..." />;
  }

  return <>{children}</>;
}
