import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  description?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, description, id, disabled, ...props }, ref) => {
    const autoId = useId();
    const fieldId = id ?? autoId;

    return (
      <label
        htmlFor={fieldId}
        className={cn(
          'flex cursor-pointer items-start gap-3 select-none',
          disabled && 'cursor-not-allowed opacity-50',
          className,
        )}
      >
        <span className="relative mt-0.5 inline-flex h-5 w-5 shrink-0">
          <input
            ref={ref}
            id={fieldId}
            type="checkbox"
            disabled={disabled}
            className="peer absolute inset-0 cursor-pointer appearance-none rounded-md border border-border bg-bg-inset transition-colors checked:border-brand-500 checked:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:cursor-not-allowed"
            {...props}
          />
          <Check className="pointer-events-none absolute inset-0 m-auto h-3.5 w-3.5 scale-0 text-text-inverse transition-transform peer-checked:scale-100" />
        </span>
        {(label || description) && (
          <span className="flex flex-col">
            {label && <span className="text-sm font-medium text-text-primary">{label}</span>}
            {description && <span className="text-xs text-text-muted">{description}</span>}
          </span>
        )}
      </label>
    );
  },
);
Checkbox.displayName = 'Checkbox';
