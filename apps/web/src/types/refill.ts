export interface RefillPurchaseOption {
  provider: string;
  providerLabel: string;
  url: string;
  matchType: 'VERIFIED_PRODUCT' | 'PROVIDER_SEARCH';
  queryPrefilled?: boolean;
  packSize?: string | null;
  verifiedAt?: string | null;
  matchScope?: 'PACKAGE' | 'MEDICINE' | null;
}

export type RefillStockStatus =
  | 'OUT'
  | 'CRITICAL'
  | 'LOW'
  | 'ADEQUATE'
  | 'GOOD'
  | 'UNKNOWN';

export type RefillForecastBasis =
  | 'ACTIVE_SCHEDULE'
  | 'REFILL_HISTORY'
  | 'THRESHOLD_ONLY'
  | 'NONE';

export interface PendingRefillOrder {
  id: string;
  status: 'ORDERED';
  provider?: string | null;
  expectedQuantity?: number | null;
  orderedAt: string;
  expectedAt?: string | null;
}

export interface InventoryEvent {
  id: string;
  type: 'REFILL_RECEIVED' | 'MANUAL_CORRECTION';
  delta: number;
  quantityBefore?: number | null;
  quantityAfter: number;
  reason?: string | null;
  createdAt: string;
}

export interface RefillOrderRecord {
  id: string;
  status: 'ORDERED' | 'RECEIVED' | 'CANCELLED';
  provider?: string | null;
  expectedQuantity?: number | null;
  receivedQuantity?: number | null;
  externalReference?: string | null;
  orderedAt: string;
  expectedAt?: string | null;
  receivedAt?: string | null;
  cancelledAt?: string | null;
}

export interface RefillMedicineHistory {
  medicine: {
    id: string;
    name: string;
    remainingQuantity: number | null;
    unit?: string | null;
  };
  orders: RefillOrderRecord[];
  inventoryEvents: InventoryEvent[];
}

export interface RefillStockForecast {
  medicineId: string;
  medicineName: string;
  medicineForm: string;
  strength?: string | null;
  unit?: string | null;
  remainingQuantity: number | null;
  totalQuantity?: number | null;
  refillThreshold?: number | null;
  dailyUsage?: number | null;
  estimatedDaysRemaining?: number | null;
  estimatedFinishDate?: string | null;
  suggestedRefillDate?: string | null;
  stockStatus: RefillStockStatus;
  needsRefill: boolean;
  forecastBasis: RefillForecastBasis;
  forecastConfidence: 'SCHEDULE_BASED' | 'HISTORY_BASED' | 'LIMITED';
  pharmacySearchQuery: string;
  pharmacyIdentity?: {
    brandName: string;
    composition?: string | null;
    manufacturer?: string | null;
    packSize?: string | null;
    identityLevel: 'PACKAGE' | 'MEDICINE' | 'MANUAL';
  };
  purchaseOptions?: RefillPurchaseOption[];
  pendingOrder?: PendingRefillOrder | null;
  recentInventoryEvents?: InventoryEvent[];
  lastRefillDate?: string | null;
  janAushadhiSubstitute?: {
    saltName: string;
    genericName: string;
    strength: string;
    brandedAveragePrice: number;
    janAushadhiPrice: number;
    composition: string;
    pmbjpCode: string;
    therapeuticCategory: string;
  } | null;
}

export interface CreateRefillOrderInput {
  provider?: string;
  expectedQuantity?: number;
  externalReference?: string;
  expectedAt?: string;
  notes?: string;
}

export interface ReceiveRefillOrderInput {
  quantity?: number;
  notes?: string;
}

export interface CorrectStockInput {
  quantity: number;
  reason: string;
}
