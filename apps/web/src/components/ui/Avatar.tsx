import { cn, initials } from '@/lib/utils';

export interface AvatarProps {
  name?: string | null;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizes = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-base',
} as const;

/** Circular avatar: shows image when available, otherwise initials on brand gradient. */
export function Avatar({ name, src, size = 'md', className }: AvatarProps) {
  if (src) {
    return (
      <img
        src={src}
        alt={name ?? 'Avatar'}
        className={cn('rounded-full object-cover ring-1 ring-border', sizes[size], className)}
      />
    );
  }
  return (
    <span
      aria-label={name ?? 'Avatar'}
      className={cn(
        'inline-flex items-center justify-center rounded-full bg-gradient-brand font-semibold text-text-inverse',
        sizes[size],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
