import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/utils';

export interface LoadingScreenProps {
  label?: string;
  /** When true, fills the parent instead of the full viewport. */
  inline?: boolean;
  className?: string;
}

/**
 * Full-screen (or inline) loading state used as the router Suspense fallback
 * and for route-level data loading.
 */
export function LoadingScreen({ label = 'Loading\u2026', inline = false, className }: LoadingScreenProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex flex-col items-center justify-center gap-4',
        inline ? 'h-full w-full py-16' : 'min-h-screen bg-bg-base bg-gradient-mesh',
        className,
      )}
    >
      <Spinner size="lg" />
      <p className="text-sm text-text-muted">{label}</p>
    </div>
  );
}
