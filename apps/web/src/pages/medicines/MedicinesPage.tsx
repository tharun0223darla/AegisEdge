import { Suspense, lazy, useMemo, useState } from 'react';
import { ImageUp, Plus, ScanLine, Search } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { MedicineList } from '@/components/medicines/MedicineList';
import { MedicineForm } from '@/components/medicines/MedicineForm';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { notify } from '@/components/ui/Toast';
import { useMedicines, useCreateMedicine } from '@/hooks/useMedicines';
import { extractErrorMessage } from '@/lib/api-client';
import type { MedicineFormValues } from '@/validation/medicine.schema';
import type { CreateMedicinePayload } from '@/types/medicine';

const BarcodeCapture = lazy(() =>
  import('@/components/medicines/BarcodeCapture').then((module) => ({
    default: module.BarcodeCapture,
  })),
);

const PackageImageCapture = lazy(() =>
  import('@/components/medicines/PackageImageCapture').then((module) => ({
    default: module.PackageImageCapture,
  })),
);

function toPayload(values: MedicineFormValues): CreateMedicinePayload {
  return {
    ...(values.medicineMasterId ? { medicineMasterId: values.medicineMasterId } : {}),
    ...(values.medicinePackageId ? { medicinePackageId: values.medicinePackageId } : {}),
    name: values.name,
    form: values.form,
    stockQuantity: values.stockQuantity,
    ...(values.brandName ? { brandName: values.brandName } : {}),
    ...(values.genericName ? { genericName: values.genericName } : {}),
    ...(values.strength ? { strength: values.strength } : {}),
    ...(values.unit ? { unit: values.unit } : {}),
    ...(values.refillThreshold != null ? { refillThreshold: values.refillThreshold } : {}),
    ...(values.source ? { source: values.source } : {}),
    ...(values.userStripImageUrl ? { userStripImageUrl: values.userStripImageUrl } : {}),
    ...(values.userStripOcrText ? { userStripOcrText: values.userStripOcrText } : {}),
    ...(values.userStripOcrEngine ? { userStripOcrEngine: values.userStripOcrEngine } : {}),
    ...(values.visualConfirmed ? { visualConfirmed: values.visualConfirmed } : {}),
    ...(values.notes ? { notes: values.notes } : {}),
  };
}

export default function MedicinesPage() {
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'ACTIVE' | 'ARCHIVED'>('ACTIVE');
  const [open, setOpen] = useState(false);
  const [barcodeOpen, setBarcodeOpen] = useState(false);
  const [packageImageOpen, setPackageImageOpen] = useState(false);
  const { data: medicines, isLoading } = useMedicines(
    viewMode === 'ACTIVE' ? { activeOnly: true } : { activeOnly: false },
  );
  const createMedicine = useCreateMedicine();

  const filtered = useMemo(() => {
    if (!medicines) return medicines;
    let list = medicines;
    if (viewMode === 'ARCHIVED') {
      list = list.filter((m) => !m.isActive);
    } else {
      list = list.filter((m) => m.isActive);
    }
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (m) => m.name.toLowerCase().includes(q) || m.brandName?.toLowerCase().includes(q),
    );
  }, [medicines, search, viewMode]);

  const handleCreate = (values: MedicineFormValues) => {
    createMedicine.mutate(toPayload(values), {
      onSuccess: () => {
        notify.success('Medicine added');
        setOpen(false);
      },
      onError: (err) => notify.error(extractErrorMessage(err, 'Failed to add medicine')),
    });
  };

  const handleBarcodeCreate = (payload: CreateMedicinePayload) => {
    createMedicine.mutate(payload, {
      onSuccess: () => {
        notify.success('Barcode medicine added');
        setBarcodeOpen(false);
      },
      onError: (err) => notify.error(extractErrorMessage(err, 'Failed to add barcode medicine')),
    });
  };

  const handlePackageImageCreate = (payload: CreateMedicinePayload) => {
    createMedicine.mutate(payload, {
      onSuccess: () => {
        notify.success('Package photo medicine added');
        setPackageImageOpen(false);
      },
      onError: (err) =>
        notify.error(extractErrorMessage(err, 'Failed to add package photo medicine')),
    });
  };

  return (
    <div>
      <PageHeader
        title="Medicines"
        description="Manage your medicines and stock."
        actions={
          <>
            <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>
              Add manually
            </Button>
            <Button
              variant="secondary"
              leftIcon={<ScanLine className="h-4 w-4" />}
              onClick={() => setBarcodeOpen(true)}
            >
              Scan barcode
            </Button>
            <Button
              variant="secondary"
              leftIcon={<ImageUp className="h-4 w-4" />}
              onClick={() => setPackageImageOpen(true)}
            >
              Add from photo
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="w-full sm:max-w-sm">
          <Input
            placeholder="Search medicines…"
            leftIcon={<Search className="h-4 w-4" />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex items-center rounded-xl border border-border bg-surface p-1 text-xs">
          <button
            type="button"
            onClick={() => setViewMode('ACTIVE')}
            className={`rounded-lg px-3 py-1.5 font-semibold transition-all ${
              viewMode === 'ACTIVE'
                ? 'bg-brand-500/20 text-brand-300 border border-brand-500/30'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            Active Medicines
          </button>
          <button
            type="button"
            onClick={() => setViewMode('ARCHIVED')}
            className={`rounded-lg px-3 py-1.5 font-semibold transition-all ${
              viewMode === 'ARCHIVED'
                ? 'bg-brand-500/20 text-brand-300 border border-brand-500/30'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            Archived / Inactive
          </button>
        </div>
      </div>

      <MedicineList medicines={filtered} isLoading={isLoading} onAdd={() => setOpen(true)} />

      <Modal open={open} onClose={() => setOpen(false)} title="Add medicine" size="lg">
        <MedicineForm
          isSubmitting={createMedicine.isPending}
          submitLabel="Add medicine"
          onSubmit={handleCreate}
          onCancel={() => setOpen(false)}
        />
      </Modal>

      <Modal
        open={barcodeOpen}
        onClose={() => setBarcodeOpen(false)}
        title="Scan barcode"
        size="lg"
        closeOnOverlay={!createMedicine.isPending}
      >
        <Suspense
          fallback={
            <div className="flex min-h-40 items-center justify-center">
              <Spinner />
            </div>
          }
        >
          <BarcodeCapture
            isSubmitting={createMedicine.isPending}
            onConfirmMatch={handleBarcodeCreate}
            onCancel={() => setBarcodeOpen(false)}
          />
        </Suspense>
      </Modal>

      <Modal
        open={packageImageOpen}
        onClose={() => setPackageImageOpen(false)}
        title="Add from package photo"
        size="lg"
        closeOnOverlay={!createMedicine.isPending}
      >
        <Suspense
          fallback={
            <div className="flex min-h-40 items-center justify-center">
              <Spinner />
            </div>
          }
        >
          <PackageImageCapture
            isSubmitting={createMedicine.isPending}
            onConfirm={handlePackageImageCreate}
            onCancel={() => setPackageImageOpen(false)}
          />
        </Suspense>
      </Modal>
    </div>
  );
}
