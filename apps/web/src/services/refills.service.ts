import { http } from '@/lib/api-client';
import type {
  CorrectStockInput,
  CreateRefillOrderInput,
  ReceiveRefillOrderInput,
  RefillMedicineHistory,
  RefillOrderRecord,
  RefillStockForecast,
} from '@/types/refill';

function idempotencyHeaders(key: string) {
  return { headers: { 'Idempotency-Key': key } };
}

export const refillsService = {
  stockSummary: () => http.get<RefillStockForecast[]>('/refills/stock-summary'),
  createOrder: (
    medicineId: string,
    input: CreateRefillOrderInput,
    idempotencyKey: string,
  ) =>
    http.post<RefillOrderRecord>(
      `/refills/medicines/${medicineId}/orders`,
      input,
      idempotencyHeaders(idempotencyKey),
    ),
  receiveOrder: (
    orderId: string,
    input: ReceiveRefillOrderInput,
    idempotencyKey: string,
  ) =>
    http.post(
      `/refills/orders/${orderId}/receive`,
      input,
      idempotencyHeaders(idempotencyKey),
    ),
  cancelOrder: (orderId: string) =>
    http.patch<RefillOrderRecord>(`/refills/orders/${orderId}/cancel`, {}),
  correctStock: (
    medicineId: string,
    input: CorrectStockInput,
    idempotencyKey: string,
  ) =>
    http.post(
      `/refills/medicines/${medicineId}/stock-corrections`,
      input,
      idempotencyHeaders(idempotencyKey),
    ),
  history: (medicineId: string) =>
    http.get<RefillMedicineHistory>(`/refills/medicines/${medicineId}/history`),
};
