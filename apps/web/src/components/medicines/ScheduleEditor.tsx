import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { scheduleSchema, type ScheduleFormValues } from '@/validation/schedule.schema';
import { FREQUENCIES, DAYS_OF_WEEK } from '@/constants/app';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import type { Schedule } from '@/types/schedule';

interface ScheduleEditorProps {
  medicineId: string;
  defaultValues?: Partial<Schedule>;
  isSubmitting?: boolean;
  submitLabel?: string;
  onSubmit: (values: ScheduleFormValues) => void;
  onCancel?: () => void;
}

const FREQ_OPTIONS = FREQUENCIES.map((frequency) => ({
  value: frequency.value,
  label: frequency.label,
}));

export function ScheduleEditor({
  medicineId,
  defaultValues,
  isSubmitting,
  submitLabel = 'Save schedule',
  onSubmit,
  onCancel,
}: ScheduleEditorProps) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ScheduleFormValues>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: {
      medicineId,
      dosesPerIntake: defaultValues?.dosesPerIntake ?? 1,
      unit: defaultValues?.unit ?? 'tablet',
      frequency: defaultValues?.frequency ?? 'DAILY',
      timesOfDay: defaultValues?.timesOfDay?.length ? defaultValues.timesOfDay : ['08:00'],
      daysOfWeek: defaultValues?.daysOfWeek ?? [],
      startDate: defaultValues?.startDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
      endDate: defaultValues?.endDate?.slice(0, 10) ?? '',
      notes: defaultValues?.notes ?? '',
    },
  });

  const frequency = watch('frequency');
  const selectedDays = watch('daysOfWeek') ?? [];
  const timesOfDay = watch('timesOfDay') ?? [];

  const toggleDay = (day: number) => {
    const next = selectedDays.includes(day)
      ? selectedDays.filter((value) => value !== day)
      : [...selectedDays, day];
    setValue('daysOfWeek', next, { shouldDirty: true, shouldValidate: true });
  };

  const addTime = () => {
    setValue('timesOfDay', [...timesOfDay, '12:00'], {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  const removeTime = (index: number) => {
    setValue(
      'timesOfDay',
      timesOfDay.filter((_, currentIndex) => currentIndex !== index),
      { shouldDirty: true, shouldValidate: true },
    );
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      <input type="hidden" {...register('medicineId')} />

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Doses per intake"
          type="number"
          min="0.5"
          max="10"
          step="0.5"
          error={errors.dosesPerIntake?.message}
          {...register('dosesPerIntake', { valueAsNumber: true })}
        />
        <Input label="Unit" placeholder="tablet" error={errors.unit?.message} {...register('unit')} />
      </div>

      <Select
        label="Frequency"
        options={FREQ_OPTIONS}
        error={errors.frequency?.message}
        {...register('frequency')}
      />

      {frequency === 'WEEKLY' && (
        <div>
          <p className="mb-1.5 text-sm font-medium text-text-primary">Days of week</p>
          <div className="flex flex-wrap gap-1.5">
            {DAYS_OF_WEEK.map((day) => (
              <button
                key={day.value}
                type="button"
                onClick={() => toggleDay(day.value)}
                aria-label={day.label}
                aria-pressed={selectedDays.includes(day.value)}
                className={cn(
                  'h-9 w-9 rounded-lg text-xs font-medium transition-colors',
                  selectedDays.includes(day.value)
                    ? 'bg-brand-500 text-text-inverse'
                    : 'border border-border text-text-secondary hover:bg-surface-hover',
                )}
              >
                {day.short}
              </button>
            ))}
          </div>
          {errors.daysOfWeek?.message && (
            <p className="mt-1.5 text-xs text-danger">{errors.daysOfWeek.message}</p>
          )}
        </div>
      )}

      {frequency !== 'AS_NEEDED' && (
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-sm font-medium text-text-primary">Times</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              leftIcon={<Plus className="h-3.5 w-3.5" />}
              onClick={addTime}
            >
              Add time
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            {timesOfDay.map((_, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  type="time"
                  className="max-w-[160px]"
                  error={errors.timesOfDay?.[index]?.message}
                  {...register(`timesOfDay.${index}` as const)}
                />
                {timesOfDay.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove time"
                    onClick={() => removeTime(index)}
                  >
                    <Trash2 className="h-4 w-4 text-danger" />
                  </Button>
                )}
              </div>
            ))}
          </div>
          {typeof errors.timesOfDay?.message === 'string' && (
            <p className="mt-1.5 text-xs text-danger">{errors.timesOfDay.message}</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Input label="Start date" type="date" error={errors.startDate?.message} {...register('startDate')} />
        <Input label="End date (optional)" type="date" error={errors.endDate?.message} {...register('endDate')} />
      </div>

      <Textarea label="Notes (optional)" rows={2} error={errors.notes?.message} {...register('notes')} />

      <div className="flex items-center justify-end gap-3 pt-2">
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
        )}
        <Button type="submit" isLoading={isSubmitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
