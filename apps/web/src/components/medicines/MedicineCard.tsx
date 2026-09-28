import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Pill, ChevronRight, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useDeleteMedicine } from '@/hooks/useMedicines';
import { notify } from '@/components/ui/Toast';
import { extractErrorMessage } from '@/lib/api-client';
import { MEDICINE_FORMS } from '@/constants/app';
import type { Medicine } from '@/types/medicine';

interface MedicineCardProps {
  medicine: Medicine;
}

function formMeta(form: string) {
  return MEDICINE_FORMS.find((f) => f.value === form);
}

function formatPrice(price?: string | null, currency = 'INR') {
  if (!price) return null;
  const value = Number(price);
  if (!Number.isFinite(value)) return `${currency} ${price}`;
  if (currency === 'INR') return `Rs ${value.toFixed(value % 1 === 0 ? 0 : 2)}`;
  return `${currency} ${value.toFixed(value % 1 === 0 ? 0 : 2)}`;
}

export function MedicineCard({ medicine }: MedicineCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const deleteMedicine = useDeleteMedicine();

  const meta = formMeta(medicine.form);
  const isLow =
    medicine.refillThreshold != null && medicine.stockQuantity <= medicine.refillThreshold;
  const composition =
    medicine.master?.composition ??
    medicine.master?.saltProfile?.displayName ??
    medicine.genericName;
  const pack = medicine.package ?? medicine.master?.packages?.[0] ?? null;
  const price = formatPrice(pack?.mrpPrice, pack?.priceCurrency ?? 'INR');

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    deleteMedicine.mutate(medicine.id, {
      onSuccess: () => {
        notify.success(`"${medicine.name}" removed successfully`);
        setConfirmOpen(false);
      },
      onError: (err) => {
        notify.error(extractErrorMessage(err, 'Failed to delete medicine'));
      },
    });
  };

  const openDeleteModal = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirmOpen(true);
  };

  return (
    <>
      <Link to={`/medicines/${medicine.id}`} className="block group">
        <Card interactive className="hover:border-brand-500/40 transition-all">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-500/12 text-lg group-hover:scale-105 transition-transform">
              {meta?.emoji ?? <Pill className="h-5 w-5 text-brand-400" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold text-text-primary group-hover:text-brand-300 transition-colors">
                  {medicine.name}
                </p>
                {!medicine.isActive && <Badge tone="muted">Inactive</Badge>}
                {medicine.medicineMasterId && <Badge tone="info">Master</Badge>}
                {!medicine.medicineMasterId && <Badge tone="warning">Not verified</Badge>}
                {medicine.master?.prescriptionRequired === true && <Badge tone="warning">Rx</Badge>}
                {price && <Badge tone="muted">{price}</Badge>}
                {isLow && (
                  <Badge tone={medicine.stockQuantity === 0 ? 'danger' : 'warning'} dot>
                    {medicine.stockQuantity === 0 ? 'Out' : 'Low'}
                  </Badge>
                )}
              </div>
              <p className="truncate text-xs text-text-muted">
                {[meta?.label ?? medicine.form, medicine.strength, `${medicine.stockQuantity} ${medicine.unit ?? 'in stock'}`]
                  .filter(Boolean)
                  .join(' - ')}
              </p>
              {(composition || medicine.master?.manufacturer || pack?.packSize) && (
                <p className="mt-0.5 truncate text-xs text-text-muted">
                  {[composition, medicine.master?.manufacturer, pack?.packSize]
                    .filter(Boolean)
                    .join(' | ')}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openDeleteModal}
                className="p-2 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors opacity-80 hover:opacity-100"
                title={`Delete ${medicine.name}`}
                aria-label={`Delete ${medicine.name}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <ChevronRight className="h-4 w-4 shrink-0 text-text-muted group-hover:text-brand-400 group-hover:translate-x-0.5 transition-all" />
            </div>
          </CardContent>
        </Card>
      </Link>

      <ConfirmDialog
        open={confirmOpen}
        title={`Delete "${medicine.name}"?`}
        description="This will permanently delete this medicine and cancel all its scheduled dose reminders."
        confirmLabel="Delete Medicine"
        destructive
        isLoading={deleteMedicine.isPending}
        onConfirm={handleDelete as any}
        onClose={() => setConfirmOpen(false)}
      />
    </>
  );
}
