import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'glass' | 'solid' | 'raised';
  interactive?: boolean;
}

const variants = {
  glass: 'bg-surface border border-border backdrop-blur-xl shadow-card',
  solid: 'bg-surface-solid border border-border shadow-card',
  raised: 'bg-surface-raised border border-border shadow-elevated',
} as const;

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = 'glass', interactive, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-2xl',
        variants[variant],
        interactive &&
          'cursor-pointer transition-all duration-300 ease-out-expo hover:border-border-strong hover:shadow-elevated hover:-translate-y-0.5',
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 p-5 pb-3', className)} {...props} />;
}
export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-base font-semibold text-text-primary', className)} {...props} />;
}
export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-text-muted', className)} {...props} />;
}
export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5 pt-0', className)} {...props} />;
}
export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center gap-3 p-5 pt-0', className)} {...props} />;
}
