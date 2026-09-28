import { type LabelHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

/** Shared form label. Input has its own inline label; use this for Select/Textarea/etc. */
export function Label({ className, required, children, ...props }: LabelProps) {
  return (
    <label className={cn('mb-1.5 block text-sm font-medium text-text-primary', className)} {...props}>
      {children}
      {required && <span className="ml-0.5 text-danger">*</span>}
    </label>
  );
}
