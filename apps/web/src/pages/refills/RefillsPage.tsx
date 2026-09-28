import { useMemo, useState } from 'react';
import {
  BadgeCheck,
  CalendarClock,
  Clipboard,
  Coins,
  ExternalLink,
  History,
  PackageCheck,
  PackageOpen,
  PackagePlus,
  PencilLine,
  ShoppingBag,
  Sparkles,
  Truck,
  TriangleAlert,
  XCircle,
  Zap,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { notify } from '@/components/ui/Toast';
import { extractErrorMessage } from '@/lib/api-client';
import {
  useRefillActions,
  useRefillHistory,
  useRefillStock,
} from '@/hooks/useRefills';
import type {
  RefillForecastBasis,
  RefillPurchaseOption,
  RefillStockForecast,
  RefillStockStatus,
} from '@/types/refill';

const statusOrder: Record<RefillStockStatus, number> = {
  OUT: 0,
  CRITICAL: 1,
  LOW: 2,
  ADEQUATE: 3,
  UNKNOWN: 4,
  GOOD: 5,
};

const statusTone: Record<
  RefillStockStatus,
  'danger' | 'warning' | 'success' | 'muted'
> = {
  OUT: 'danger',
  CRITICAL: 'danger',
  LOW: 'warning',
  ADEQUATE: 'warning',
  GOOD: 'success',
  UNKNOWN: 'muted',
};

const basisLabel: Record<RefillForecastBasis, string> = {
  ACTIVE_SCHEDULE: 'Based on active schedule',
  REFILL_HISTORY: 'Based on refill history',
  THRESHOLD_ONLY: 'Based on stock threshold',
  NONE: 'Usage not available',
};

function daysLabel(item: RefillStockForecast) {
  if (item.stockStatus === 'OUT') return 'Out of stock';
  if (item.estimatedDaysRemaining == null) return 'Days remaining unavailable';
  if (item.estimatedDaysRemaining === 1) return 'About 1 day remaining';
  return `About ${item.estimatedDaysRemaining} days remaining`;
}

function createRequestKey() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `refill-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function openExternalLink(url: string) {
  const popup = window.open(url, '_blank', 'noopener,noreferrer');
  if (popup) popup.opener = null;
}

function openPurchaseOption(
  item: RefillStockForecast,
  option: RefillPurchaseOption,
) {
  if (
    option.matchType === 'PROVIDER_SEARCH' &&
    option.queryPrefilled === false
  ) {
    void navigator.clipboard
      .writeText(item.pharmacySearchQuery)
      .then(() =>
        notify.message(
          `Search phrase copied. Paste it into ${option.providerLabel}.`,
        ),
      )
      .catch(() =>
        notify.message(
          `Search for "${item.pharmacySearchQuery}" on ${option.providerLabel}.`,
        ),
      );
  }
  openExternalLink(option.url);
}

export default function RefillsPage() {
  const [expandedMedicineId, setExpandedMedicineId] = useState<string | null>(
    null,
  );
  const { data = [], isLoading, error, refetch, isFetching } = useRefillStock();
  const actions = useRefillActions();
  const [orderItem, setOrderItem] = useState<RefillStockForecast | null>(null);
  const [receiveItem, setReceiveItem] = useState<RefillStockForecast | null>(
    null,
  );
  const [correctionItem, setCorrectionItem] =
    useState<RefillStockForecast | null>(null);
  const [historyMedicineId, setHistoryMedicineId] = useState<string | null>(
    null,
  );
  const [provider, setProvider] = useState('');
  const [orderQuantity, setOrderQuantity] = useState('');
  const [orderReference, setOrderReference] = useState('');
  const [expectedAt, setExpectedAt] = useState('');
  const [receiveQuantity, setReceiveQuantity] = useState('');
  const [correctedQuantity, setCorrectedQuantity] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [janAushadhiModalItem, setJanAushadhiModalItem] =
    useState<RefillStockForecast | null>(null);
  const historyQuery = useRefillHistory(historyMedicineId);

  const totalAnnualGenericSavings = useMemo(() => {
    return data.reduce((acc, item) => {
      if (item.janAushadhiSubstitute) {
        const perStripSaving = Math.max(
          0,
          item.janAushadhiSubstitute.brandedAveragePrice -
            item.janAushadhiSubstitute.janAushadhiPrice,
        );
        return acc + perStripSaving * 12;
      }
      return acc;
    }, 0);
  }, [data]);

  const handle1ClickAutoRefill = async (
    item: RefillStockForecast,
    providerName = 'Jan Aushadhi (PMBJP)',
  ) => {
    try {
      await actions.createOrder.mutateAsync({
        medicineId: item.medicineId,
        idempotencyKey: createRequestKey(),
        input: {
          provider: providerName,
          expectedQuantity: item.totalQuantity || 30,
          externalReference: `AUTO-${Date.now().toString().slice(-6)}`,
        },
      });
      notify.success(`⚡ 1-Click Auto-Refill Placed with ${providerName}!`);
    } catch (error) {
      notify.error(
        extractErrorMessage(error, 'Unable to place auto-refill order'),
      );
    }
  };
  const forecasts = useMemo(
    () =>
      [...data].sort(
        (left, right) =>
          statusOrder[left.stockStatus] - statusOrder[right.stockStatus] ||
          left.medicineName.localeCompare(right.medicineName),
      ),
    [data],
  );
  const attentionCount = forecasts.filter((item) => item.needsRefill).length;
  const unknownCount = forecasts.filter(
    (item) => item.stockStatus === 'UNKNOWN',
  ).length;

  const copySearchName = async (item: RefillStockForecast) => {
    try {
      await navigator.clipboard.writeText(item.pharmacySearchQuery);
      notify.success('Medicine search name copied');
    } catch {
      notify.error('Unable to copy the medicine name');
    }
  };

  const openOrder = (item: RefillStockForecast) => {
    setOrderItem(item);
    setProvider('');
    setOrderQuantity(item.totalQuantity ? String(item.totalQuantity) : '');
    setOrderReference('');
    setExpectedAt('');
  };

  const submitOrder = async () => {
    if (!orderItem) return;
    const quantity = orderQuantity ? Number(orderQuantity) : undefined;
    if (
      quantity !== undefined &&
      (!Number.isInteger(quantity) || quantity < 1)
    ) {
      notify.error(
        'Expected quantity must be a whole number greater than zero',
      );
      return;
    }
    try {
      await actions.createOrder.mutateAsync({
        medicineId: orderItem.medicineId,
        idempotencyKey: createRequestKey(),
        input: {
          provider: provider.trim() || undefined,
          expectedQuantity: quantity,
          externalReference: orderReference.trim() || undefined,
          expectedAt: expectedAt || undefined,
        },
      });
      notify.success('Refill marked as ordered. Stock was not changed.');
      setOrderItem(null);
    } catch (error) {
      notify.error(extractErrorMessage(error, 'Unable to record the order'));
    }
  };

  const openReceive = (item: RefillStockForecast) => {
    setReceiveItem(item);
    setReceiveQuantity(
      item.pendingOrder?.expectedQuantity
        ? String(item.pendingOrder.expectedQuantity)
        : '',
    );
  };

  const submitReceive = async () => {
    if (!receiveItem?.pendingOrder) return;
    const quantity = Number(receiveQuantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      notify.error('Enter the number of stock units you physically received');
      return;
    }
    try {
      await actions.receiveOrder.mutateAsync({
        medicineId: receiveItem.medicineId,
        orderId: receiveItem.pendingOrder.id,
        idempotencyKey: createRequestKey(),
        input: { quantity },
      });
      notify.success('Refill received and stock updated');
      setReceiveItem(null);
    } catch (error) {
      notify.error(extractErrorMessage(error, 'Unable to receive the refill'));
    }
  };

  const cancelPendingOrder = async (item: RefillStockForecast) => {
    if (!item.pendingOrder) return;
    try {
      await actions.cancelOrder.mutateAsync({
        medicineId: item.medicineId,
        orderId: item.pendingOrder.id,
      });
      notify.success('Outstanding refill order cancelled');
    } catch (error) {
      notify.error(extractErrorMessage(error, 'Unable to cancel the order'));
    }
  };

  const openCorrection = (item: RefillStockForecast) => {
    setCorrectionItem(item);
    setCorrectedQuantity(
      item.remainingQuantity === null ? '' : String(item.remainingQuantity),
    );
    setCorrectionReason('');
  };

  const submitCorrection = async () => {
    if (!correctionItem) return;
    const quantity = Number(correctedQuantity);
    if (!Number.isInteger(quantity) || quantity < 0) {
      notify.error('Stock must be a whole number of zero or more');
      return;
    }
    if (correctionReason.trim().length < 5) {
      notify.error('Add a short reason for this stock correction');
      return;
    }
    try {
      await actions.correctStock.mutateAsync({
        medicineId: correctionItem.medicineId,
        idempotencyKey: createRequestKey(),
        input: { quantity, reason: correctionReason.trim() },
      });
      notify.success('Stock reconciled and added to inventory history');
      setCorrectionItem(null);
    } catch (error) {
      notify.error(extractErrorMessage(error, 'Unable to correct stock'));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Refills"
        description="Review current stock and estimated refill timing."
        actions={
          <Button
            variant="secondary"
            onClick={() => void refetch()}
            isLoading={isFetching}
          >
            Refresh
          </Button>
        }
      />

      {!isLoading && !error && forecasts.length > 0 && (
        <section className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
          <div className="bg-surface px-4 py-3">
            <p className="text-xs text-text-muted">Active medicines</p>
            <p className="mt-1 text-xl font-semibold text-text-primary">
              {forecasts.length}
            </p>
          </div>
          <div className="bg-surface px-4 py-3">
            <p className="text-xs text-text-muted">Need attention</p>
            <p className="mt-1 text-xl font-semibold text-warning">
              {attentionCount}
            </p>
          </div>
          <div className="bg-surface px-4 py-3">
            <p className="text-xs text-text-muted">Need usage details</p>
            <p className="mt-1 text-xl font-semibold text-text-primary">
              {unknownCount}
            </p>
          </div>
        </section>
      )}

      {isLoading && (
        <div className="flex min-h-48 items-center justify-center">
          <Spinner size="lg" />
        </div>
      )}

      {error && (
        <Card className="p-6">
          <EmptyState
            icon={<TriangleAlert className="h-6 w-6" />}
            title="Unable to load refill status"
            description={extractErrorMessage(
              error,
              'Check your connection and try again.',
            )}
            action={<Button onClick={() => void refetch()}>Try again</Button>}
          />
        </Card>
      )}

      {!isLoading && !error && forecasts.length === 0 && (
        <Card className="p-6">
          <EmptyState
            icon={<PackageCheck className="h-6 w-6" />}
            title="No active medicines"
            description="Add a medicine with its current stock to begin tracking refills."
          />
        </Card>
      )}

      {!isLoading && !error && forecasts.length > 0 && (
        <div className="space-y-4">
          {totalAnnualGenericSavings > 0 && (
            <div className="relative overflow-hidden rounded-xl border border-emerald-500/30 bg-gradient-to-r from-emerald-950/50 via-teal-950/30 to-slate-900 p-4 shadow-lg">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40">
                    <Coins className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-white">
                        🇮🇳 PMBJP Jan Aushadhi Generic Savings Active
                      </h3>
                      <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-bold text-emerald-300">
                        Save Up to 84%
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-emerald-200/80">
                      Save an estimated <span className="font-bold text-emerald-300">₹{totalAnnualGenericSavings.toLocaleString('en-IN')}/year</span> by switching chronic prescriptions to bioequivalent Jan Aushadhi generic salts.
                    </p>
                  </div>
                </div>
                <div className="shrink-0">
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300">
                    <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
                    WHO-GMP Certified
                  </span>
                </div>
              </div>
            </div>
          )}

          <section className="grid grid-cols-1 gap-3">
          {forecasts.map((item) => {
            const purchaseOptions = item.purchaseOptions ?? [];
            const exactOptions = purchaseOptions.filter(
              (option) => option.matchType === 'VERIFIED_PRODUCT',
            );
            const searchOptions = purchaseOptions.filter(
              (option) => option.matchType === 'PROVIDER_SEARCH',
            );
            return (
              <Card key={item.medicineId} className="p-4 sm:p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-text-primary">
                        {item.medicineName}
                      </h2>
                      <Badge tone={statusTone[item.stockStatus]} dot>
                        {item.stockStatus.toLowerCase()}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-text-secondary">
                      {[item.strength, item.medicineForm.toLowerCase()]
                        .filter(Boolean)
                        .join(' / ')}
                    </p>

                    <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                      <div>
                        <p className="text-xs text-text-muted">Current stock</p>
                        <p className="mt-1 font-medium text-text-primary">
                          {item.remainingQuantity === null
                            ? 'Not recorded'
                            : `${item.remainingQuantity} ${item.unit ?? 'units'}`}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-text-muted">Forecast</p>
                        <p className="mt-1 font-medium text-text-primary">
                          {daysLabel(item)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-text-muted">Refill by</p>
                        <p className="mt-1 font-medium text-text-primary">
                          {item.suggestedRefillDate ?? 'Not estimated'}
                        </p>
                      </div>
                    </div>

                    {item.janAushadhiSubstitute && (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold text-white">
                            ₹
                          </span>
                          <div>
                            <span className="font-semibold text-emerald-300">
                              Jan Aushadhi Generic: {item.janAushadhiSubstitute.genericName}
                            </span>
                            <span className="ml-2 text-emerald-200/80">
                              (PMBJP ₹{item.janAushadhiSubstitute.janAushadhiPrice} vs Brand ₹{item.janAushadhiSubstitute.brandedAveragePrice} • Save {Math.round(((item.janAushadhiSubstitute.brandedAveragePrice - item.janAushadhiSubstitute.janAushadhiPrice) / item.janAushadhiSubstitute.brandedAveragePrice) * 100)}%)
                            </span>
                          </div>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="border-emerald-500/40 bg-emerald-950/60 text-emerald-300 hover:bg-emerald-900 hover:text-white text-xs h-7 py-0"
                          onClick={() => setJanAushadhiModalItem(item)}
                        >
                          View & Switch
                        </Button>
                      </div>
                    )}

                    <p className="mt-3 flex items-center gap-1.5 text-xs text-text-muted">
                      <CalendarClock className="h-3.5 w-3.5" />
                      {basisLabel[item.forecastBasis]}. Confirm current stock
                      before ordering.
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    {item.needsRefill && (
                      <Button
                        size="sm"
                        className="bg-gradient-to-r from-amber-500 to-emerald-600 font-bold text-white shadow-md hover:from-amber-600 hover:to-emerald-700"
                        leftIcon={<Zap className="h-4 w-4" />}
                        onClick={() => void handle1ClickAutoRefill(item)}
                      >
                        ⚡ 1-Click Auto-Refill
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      leftIcon={<History className="h-4 w-4" />}
                      onClick={() => setHistoryMedicineId(item.medicineId)}
                    >
                      History
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      leftIcon={<PencilLine className="h-4 w-4" />}
                      onClick={() => openCorrection(item)}
                    >
                      Adjust stock
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      leftIcon={<Clipboard className="h-4 w-4" />}
                      onClick={() => void copySearchName(item)}
                    >
                      Copy name
                    </Button>
                    <Button
                      size="sm"
                      leftIcon={
                        item.needsRefill ? (
                          <PackageOpen className="h-4 w-4" />
                        ) : (
                          <ShoppingBag className="h-4 w-4" />
                        )
                      }
                      onClick={() =>
                        setExpandedMedicineId((current) =>
                          current === item.medicineId ? null : item.medicineId,
                        )
                      }
                      aria-expanded={expandedMedicineId === item.medicineId}
                    >
                      Buying options
                    </Button>
                  </div>
                </div>

                {item.pendingOrder && (
                  <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-medium text-text-primary">
                        <Truck className="h-4 w-4 text-brand-500" />
                        Refill ordered
                      </p>
                      <p className="mt-1 text-xs leading-5 text-text-muted">
                        {item.pendingOrder.provider || 'Provider not recorded'}
                        {item.pendingOrder.expectedQuantity
                          ? ` - ${item.pendingOrder.expectedQuantity} ${item.unit ?? 'units'} expected`
                          : ''}
                        {item.pendingOrder.expectedAt
                          ? ` - expected ${item.pendingOrder.expectedAt.slice(0, 10)}`
                          : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        size="sm"
                        leftIcon={<PackagePlus className="h-4 w-4" />}
                        onClick={() => openReceive(item)}
                      >
                        Receive
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<XCircle className="h-4 w-4" />}
                        isLoading={actions.cancelOrder.isPending}
                        onClick={() => void cancelPendingOrder(item)}
                      >
                        Cancel order
                      </Button>
                    </div>
                  </div>
                )}

                {expandedMedicineId === item.medicineId && (
                  <div className="mt-4 border-t border-border pt-4">
                    <div className="mb-4 grid grid-cols-1 gap-3 border-b border-border pb-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <p className="text-xs text-text-muted">Confirm brand</p>
                        <p className="mt-1 font-medium text-text-primary">
                          {item.pharmacyIdentity?.brandName ??
                            item.medicineName}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-text-muted">Composition</p>
                        <p className="mt-1 font-medium text-text-primary">
                          {item.pharmacyIdentity?.composition ?? 'Not recorded'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-text-muted">Manufacturer</p>
                        <p className="mt-1 font-medium text-text-primary">
                          {item.pharmacyIdentity?.manufacturer ??
                            'Not recorded'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-text-muted">Selected pack</p>
                        <p className="mt-1 font-medium text-text-primary">
                          {item.pharmacyIdentity?.packSize ?? 'Not selected'}
                        </p>
                      </div>
                    </div>

                    {exactOptions.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2">
                          <BadgeCheck className="h-4 w-4 text-success" />
                          <h3 className="text-sm font-semibold text-text-primary">
                            Reviewed product links
                          </h3>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {exactOptions.map((option) => (
                            <Button
                              key={`${option.provider}-${option.url}`}
                              variant="secondary"
                              size="sm"
                              rightIcon={
                                <ExternalLink className="h-3.5 w-3.5" />
                              }
                              onClick={() => openExternalLink(option.url)}
                              title={[
                                option.matchScope === 'PACKAGE'
                                  ? 'Selected package matched'
                                  : 'Medicine matched; confirm pack',
                                option.packSize,
                                option.verifiedAt
                                  ? `Checked ${option.verifiedAt}`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(' - ')}
                            >
                              {option.providerLabel}
                              {option.packSize ? ` - ${option.packSize}` : ''}
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}

                    {searchOptions.length > 0 && (
                      <div className={exactOptions.length > 0 ? 'mt-4' : ''}>
                        <div className="flex items-center gap-2">
                          <TriangleAlert className="h-4 w-4 text-warning" />
                          <h3 className="text-sm font-semibold text-text-primary">
                            Provider searches, not verified products
                          </h3>
                        </div>
                        <div className="mt-2 border-l-2 border-warning pl-3">
                          <p className="text-xs leading-5 text-text-secondary">
                            Results may contain advertisements, substitutes, or
                            different strengths. Do not select the first result
                            automatically. Confirm every identity field shown
                            above.
                          </p>
                          <p className="mt-1 break-words text-xs text-text-muted">
                            Search phrase: {item.pharmacySearchQuery}
                          </p>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {searchOptions.map((option) => (
                            <Button
                              key={option.provider}
                              variant="outline"
                              size="sm"
                              rightIcon={
                                <ExternalLink className="h-3.5 w-3.5" />
                              }
                              onClick={() => openPurchaseOption(item, option)}
                            >
                              {option.queryPrefilled === false
                                ? `Open ${option.providerLabel} - name copied`
                                : `Search ${option.providerLabel}`}
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}

                    {purchaseOptions.length === 0 && (
                      <p className="text-sm text-text-secondary">
                        Buying links are temporarily unavailable. Copy the
                        medicine name and confirm the exact pack with your
                        pharmacy.
                      </p>
                    )}

                    {!item.pendingOrder && (
                      <div className="mt-4 border-t border-border pt-4">
                        <Button
                          size="sm"
                          leftIcon={<PackagePlus className="h-4 w-4" />}
                          onClick={() => openOrder(item)}
                        >
                          Mark refill ordered
                        </Button>
                        <p className="mt-2 text-xs text-text-muted">
                          This records the order only. Stock changes after you
                          confirm the refill was received.
                        </p>
                      </div>
                    )}

                    <p className="mt-4 text-xs leading-5 text-text-muted">
                      Availability and price are controlled by the pharmacy.
                      Prescription medicines still require a valid prescription.
                      MediTrack never orders automatically.
                    </p>
                  </div>
                )}
              </Card>
            );
          })}
        </section>
      </div>
      )}

      <Modal
        open={orderItem !== null}
        onClose={() => setOrderItem(null)}
        title="Mark refill ordered"
        description={
          orderItem
            ? `Record the order for ${orderItem.medicineName}.`
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setOrderItem(null)}>
              Cancel
            </Button>
            <Button
              leftIcon={<Truck className="h-4 w-4" />}
              isLoading={actions.createOrder.isPending}
              onClick={() => void submitOrder()}
            >
              Mark ordered
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="border-l-2 border-brand-500 pl-3 text-sm leading-6 text-text-secondary">
            Recording an order does not change stock. Add stock only after the
            medicine is physically received.
          </div>
          <Input
            label="Provider or pharmacy (optional)"
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            placeholder="e.g. Apollo Pharmacy"
            maxLength={120}
          />
          <Input
            label="Expected quantity (optional)"
            type="number"
            min="1"
            step="1"
            value={orderQuantity}
            onChange={(event) => setOrderQuantity(event.target.value)}
            placeholder="Number of tablets, capsules, or units"
          />
          <Input
            label="Order reference (optional)"
            value={orderReference}
            onChange={(event) => setOrderReference(event.target.value)}
            placeholder="Receipt or order number"
            maxLength={120}
          />
          <Input
            label="Expected arrival (optional)"
            type="datetime-local"
            value={expectedAt}
            onChange={(event) => setExpectedAt(event.target.value)}
          />
        </div>
      </Modal>

      <Modal
        open={receiveItem !== null}
        onClose={() => setReceiveItem(null)}
        title="Receive refill"
        description={
          receiveItem
            ? `Confirm what arrived for ${receiveItem.medicineName}.`
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setReceiveItem(null)}>
              Cancel
            </Button>
            <Button
              leftIcon={<PackagePlus className="h-4 w-4" />}
              isLoading={actions.receiveOrder.isPending}
              onClick={() => void submitReceive()}
            >
              Add to stock
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm leading-6 text-text-secondary">
            Enter the number of physical stock units received. This action is
            idempotent and can increase stock only once for this order.
          </p>
          <Input
            label={`Quantity received${receiveItem?.unit ? ` (${receiveItem.unit})` : ''}`}
            type="number"
            min="1"
            step="1"
            value={receiveQuantity}
            onChange={(event) => setReceiveQuantity(event.target.value)}
            autoFocus
          />
        </div>
      </Modal>

      <Modal
        open={correctionItem !== null}
        onClose={() => setCorrectionItem(null)}
        title="Adjust recorded stock"
        description={
          correctionItem
            ? `Reconcile ${correctionItem.medicineName} with a physical count.`
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setCorrectionItem(null)}>
              Cancel
            </Button>
            <Button
              leftIcon={<PencilLine className="h-4 w-4" />}
              isLoading={actions.correctStock.isPending}
              onClick={() => void submitCorrection()}
            >
              Save correction
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label={`Physical stock count${correctionItem?.unit ? ` (${correctionItem.unit})` : ''}`}
            type="number"
            min="0"
            step="1"
            value={correctedQuantity}
            onChange={(event) => setCorrectedQuantity(event.target.value)}
          />
          <Textarea
            label="Reason"
            value={correctionReason}
            onChange={(event) => setCorrectionReason(event.target.value)}
            placeholder="e.g. Counted the remaining strip after a missed dose log"
            hint="Required for the inventory audit trail."
            minLength={5}
            maxLength={300}
          />
        </div>
      </Modal>

      <Modal
        open={historyMedicineId !== null}
        onClose={() => setHistoryMedicineId(null)}
        title="Refill and stock history"
        description={historyQuery.data?.medicine.name}
        size="lg"
      >
        {historyQuery.isLoading && (
          <div className="flex min-h-32 items-center justify-center">
            <Spinner />
          </div>
        )}
        {historyQuery.error && (
          <EmptyState
            icon={<TriangleAlert className="h-6 w-6" />}
            title="Unable to load history"
            description={extractErrorMessage(
              historyQuery.error,
              'Try again shortly.',
            )}
            action={
              <Button onClick={() => void historyQuery.refetch()}>
                Try again
              </Button>
            }
          />
        )}
        {historyQuery.data && (
          <div className="space-y-6">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <span className="text-sm text-text-muted">Recorded balance</span>
              <span className="font-semibold text-text-primary">
                {historyQuery.data.medicine.remainingQuantity ?? 'Not recorded'}{' '}
                {historyQuery.data.medicine.unit ?? 'units'}
              </span>
            </div>
            <section>
              <h3 className="text-sm font-semibold text-text-primary">
                Orders
              </h3>
              {historyQuery.data.orders.length === 0 ? (
                <p className="mt-2 text-sm text-text-muted">
                  No refill orders recorded.
                </p>
              ) : (
                <div className="mt-2 divide-y divide-border border-y border-border">
                  {historyQuery.data.orders.map((order) => (
                    <div
                      key={order.id}
                      className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <p className="font-medium text-text-primary">
                          {order.provider || 'Provider not recorded'}
                        </p>
                        <p className="text-xs text-text-muted">
                          Ordered {new Date(order.orderedAt).toLocaleString()}
                        </p>
                      </div>
                      <Badge
                        tone={
                          order.status === 'RECEIVED'
                            ? 'success'
                            : order.status === 'CANCELLED'
                              ? 'muted'
                              : 'warning'
                        }
                      >
                        {order.status.toLowerCase()}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <section>
              <h3 className="text-sm font-semibold text-text-primary">
                Inventory changes
              </h3>
              {historyQuery.data.inventoryEvents.length === 0 ? (
                <p className="mt-2 text-sm text-text-muted">
                  No inventory changes recorded.
                </p>
              ) : (
                <div className="mt-2 divide-y divide-border border-y border-border">
                  {historyQuery.data.inventoryEvents.map((event) => (
                    <div key={event.id} className="py-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium text-text-primary">
                          {event.type === 'REFILL_RECEIVED'
                            ? 'Refill received'
                            : 'Stock correction'}
                        </p>
                        <span
                          className={
                            event.delta >= 0 ? 'text-success' : 'text-warning'
                          }
                        >
                          {event.delta >= 0 ? '+' : ''}
                          {event.delta}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-text-muted">
                        Balance {event.quantityBefore ?? 'unknown'} to{' '}
                        {event.quantityAfter} -{' '}
                        {new Date(event.createdAt).toLocaleString()}
                      </p>
                      {event.reason && (
                        <p className="mt-1 text-xs leading-5 text-text-secondary">
                          {event.reason}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </Modal>

      <Modal
        open={janAushadhiModalItem !== null}
        onClose={() => setJanAushadhiModalItem(null)}
        title="Jan Aushadhi Bioequivalent Generic"
        description={
          janAushadhiModalItem
            ? `Pradhan Mantri Bhartiya Janaushadhi Pariyojana (PMBJP) Generic Alternative for ${janAushadhiModalItem.medicineName}`
            : undefined
        }
        size="lg"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setJanAushadhiModalItem(null)}
            >
              Close
            </Button>
            <Button
              variant="outline"
              rightIcon={<ExternalLink className="h-4 w-4" />}
              onClick={() =>
                openExternalLink(
                  'https://janaushadhi.gov.in/KendraDetails.aspx',
                )
              }
            >
              Find PMBJP Kendra
            </Button>
            {janAushadhiModalItem && (
              <Button
                className="bg-emerald-600 font-bold text-white hover:bg-emerald-500"
                leftIcon={<Zap className="h-4 w-4" />}
                onClick={() => {
                  const target = janAushadhiModalItem;
                  setJanAushadhiModalItem(null);
                  void handle1ClickAutoRefill(
                    target,
                    'Jan Aushadhi Kendra (PMBJP)',
                  );
                }}
              >
                ⚡ 1-Click Refill Order
              </Button>
            )}
          </>
        }
      >
        {janAushadhiModalItem?.janAushadhiSubstitute && (
          <div className="space-y-5">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/30 p-4 text-xs">
              <div className="flex items-center gap-2 font-semibold text-emerald-300">
                <BadgeCheck className="h-4 w-4 text-emerald-400" />
                CDSCO & WHO-GMP Certified Bioequivalent Salt
              </div>
              <p className="mt-1 text-emerald-200/80">
                Under the PMBJP scheme, generic medicines contain the identical active pharmaceutical ingredient (API), strength, bioavailability, and therapeutic effect as patented/branded variants at government-subsidized rates.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-surface p-4">
                <div className="text-xs font-semibold text-text-muted">
                  Current Branded Medicine
                </div>
                <div className="mt-1 text-base font-bold text-text-primary">
                  {janAushadhiModalItem.medicineName}
                </div>
                <div className="mt-1 text-xs text-text-secondary">
                  {janAushadhiModalItem.strength} • {janAushadhiModalItem.medicineForm}
                </div>
                <div className="mt-3 border-t border-border pt-3">
                  <div className="text-xs text-text-muted">Market Average Price</div>
                  <div className="text-lg font-bold text-text-primary">
                    ₹{janAushadhiModalItem.janAushadhiSubstitute.brandedAveragePrice}
                    <span className="text-xs font-normal text-text-muted"> / strip</span>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border-2 border-emerald-500/50 bg-emerald-950/20 p-4 ring-1 ring-emerald-500/20">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                    PMBJP Generic Substitute
                  </div>
                  <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                    CODE: {janAushadhiModalItem.janAushadhiSubstitute.pmbjpCode}
                  </span>
                </div>
                <div className="mt-1 text-base font-bold text-emerald-300">
                  {janAushadhiModalItem.janAushadhiSubstitute.genericName}
                </div>
                <div className="mt-1 text-xs text-emerald-200/80">
                  Active Salt: {janAushadhiModalItem.janAushadhiSubstitute.saltName} ({janAushadhiModalItem.janAushadhiSubstitute.strength})
                </div>
                <div className="mt-3 border-t border-emerald-500/30 pt-3">
                  <div className="text-xs text-emerald-300/80">Jan Aushadhi Subsidized Price</div>
                  <div className="text-xl font-black text-emerald-400">
                    ₹{janAushadhiModalItem.janAushadhiSubstitute.janAushadhiPrice}
                    <span className="text-xs font-normal text-emerald-300/80"> / strip</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-emerald-500/30 bg-gradient-to-r from-emerald-900/30 to-teal-900/20 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-emerald-300/80">Net Savings Per Refill</div>
                  <div className="text-2xl font-black text-emerald-300">
                    ₹{janAushadhiModalItem.janAushadhiSubstitute.brandedAveragePrice - janAushadhiModalItem.janAushadhiSubstitute.janAushadhiPrice}
                    <span className="text-sm font-semibold text-emerald-400">
                      {' '}({Math.round(((janAushadhiModalItem.janAushadhiSubstitute.brandedAveragePrice - janAushadhiModalItem.janAushadhiSubstitute.janAushadhiPrice) / janAushadhiModalItem.janAushadhiSubstitute.brandedAveragePrice) * 100)}% cheaper)
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-emerald-300/80">Est. Annual Patient Saving</div>
                  <div className="text-xl font-black text-emerald-400">
                    ₹{((janAushadhiModalItem.janAushadhiSubstitute.brandedAveragePrice - janAushadhiModalItem.janAushadhiSubstitute.janAushadhiPrice) * 12).toLocaleString('en-IN')}/yr
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <p className="text-xs leading-5 text-text-muted">
        Refill dates are estimates based on recorded stock and schedules. No
        medicine is ordered automatically.
      </p>
    </div>
  );
}
