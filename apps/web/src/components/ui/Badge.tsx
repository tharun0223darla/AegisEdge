import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export type BadgeTone = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'accent';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  dot?: boolean;
}

const tones: Record<BadgeTone, string> = {
  brand: 'bg-brand-500/12 text-brand-400 ring-1 ring-inset ring-brand-500/20',
  success: 'bg-success-soft text-success ring-1 ring-inset ring-success/20',
  warning: 'bg-warning-soft text-warning ring-1 ring-inset ring-warning/20',
  danger: 'bg-danger-soft text-danger ring-1 ring-inset ring-danger/20',
  info: 'bg-info-soft text-info ring-1 ring-inset ring-info/20',
  accent: 'bg-brand-500/12 text-brand-400 ring-1 ring-inset ring-brand-500/20',
  muted: 'bg-surface-hover text-text-muted ring-1 ring-inset ring-border',
};

const dotColors: Record<BadgeTone, string> = {
  brand: 'bg-brand-500',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  accent: 'bg-brand-500',
  muted: 'bg-text-muted',
};

export function Badge({ className, tone = 'muted', dot = false, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
      {...props}
    >
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', dotColors[tone])} />}
      {children}
    </span>
  );
}
