import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  description?: string;
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, label, description, id, disabled, ...props }, ref) => {
    const autoId = useId();
    const fieldId = id ?? autoId;

    return (
      <label
        htmlFor={fieldId}
        className={cn(
          'flex cursor-pointer items-center justify-between gap-4 select-none',
          disabled && 'cursor-not-allowed opacity-50',
          className,
        )}
      >
        {(label || description) && (
          <span className="flex flex-col">
            {label && <span className="text-sm font-medium text-text-primary">{label}</span>}
            {description && <span className="text-xs text-text-muted">{description}</span>}
          </span>
        )}
        <span className="relative inline-flex h-6 w-11 shrink-0">
          <input
            ref={ref}
            id={fieldId}
            type="checkbox"
            role="switch"
            disabled={disabled}
            className="peer absolute inset-0 cursor-pointer appearance-none rounded-full border border-border bg-surface-raised transition-colors checked:border-brand-500 checked:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:cursor-not-allowed"
            {...props}
          />
          <span className="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-text-primary transition-transform duration-200 ease-out-expo peer-checked:translate-x-5 peer-checked:bg-text-inverse" />
        </span>
      </label>
    );
  },
);
Switch.displayName = 'Switch';
