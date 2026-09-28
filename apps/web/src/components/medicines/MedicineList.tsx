import { Pill, Plus } from 'lucide-react';
import { MedicineCard } from './MedicineCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import type { Medicine } from '@/types/medicine';

interface MedicineListProps {
  medicines?: Medicine[];
  isLoading?: boolean;
  onAdd?: () => void;
}

export function MedicineList({ medicines, isLoading, onAdd }: MedicineListProps) {
  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[76px] w-full" />
        ))}
      </div>
    );
  }

  if (!medicines || medicines.length === 0) {
    return (
      <EmptyState
        icon={<Pill className="h-6 w-6" />}
        title="No medicines yet"
        description="Add your first medicine to start tracking doses and adherence."
        action={
          onAdd && (
            <Button leftIcon={<Plus className="h-4 w-4" />} onClick={onAdd}>
              Add medicine
            </Button>
          )
        }
      />
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {medicines.map((m) => (
        <MedicineCard key={m.id} medicine={m} />
      ))}
    </div>
  );
}
