import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { refillsService } from '@/services/refills.service';
import type {
  CorrectStockInput,
  CreateRefillOrderInput,
  ReceiveRefillOrderInput,
} from '@/types/refill';

export const refillKeys = {
  all: ['refills'] as const,
  stock: () => [...refillKeys.all, 'stock'] as const,
  history: (medicineId: string) =>
    [...refillKeys.all, 'history', medicineId] as const,
};

export function useRefillStock() {
  return useQuery({
    queryKey: refillKeys.stock(),
    queryFn: refillsService.stockSummary,
    staleTime: 60_000,
  });
}

export function useRefillHistory(medicineId: string | null) {
  return useQuery({
    queryKey: refillKeys.history(medicineId ?? 'none'),
    queryFn: () => refillsService.history(medicineId!),
    enabled: Boolean(medicineId),
  });
}

export function useRefillActions() {
  const queryClient = useQueryClient();
  const refresh = (medicineId?: string) => {
    void queryClient.invalidateQueries({ queryKey: refillKeys.stock() });
    if (medicineId) {
      void queryClient.invalidateQueries({
        queryKey: refillKeys.history(medicineId),
      });
    }
  };

  const createOrder = useMutation({
    mutationFn: (variables: {
      medicineId: string;
      input: CreateRefillOrderInput;
      idempotencyKey: string;
    }) =>
      refillsService.createOrder(
        variables.medicineId,
        variables.input,
        variables.idempotencyKey,
      ),
    onSuccess: (_data, variables) => refresh(variables.medicineId),
  });

  const receiveOrder = useMutation({
    mutationFn: (variables: {
      medicineId: string;
      orderId: string;
      input: ReceiveRefillOrderInput;
      idempotencyKey: string;
    }) =>
      refillsService.receiveOrder(
        variables.orderId,
        variables.input,
        variables.idempotencyKey,
      ),
    onSuccess: (_data, variables) => refresh(variables.medicineId),
  });

  const cancelOrder = useMutation({
    mutationFn: (variables: { medicineId: string; orderId: string }) =>
      refillsService.cancelOrder(variables.orderId),
    onSuccess: (_data, variables) => refresh(variables.medicineId),
  });

  const correctStock = useMutation({
    mutationFn: (variables: {
      medicineId: string;
      input: CorrectStockInput;
      idempotencyKey: string;
    }) =>
      refillsService.correctStock(
        variables.medicineId,
        variables.input,
        variables.idempotencyKey,
      ),
    onSuccess: (_data, variables) => refresh(variables.medicineId),
  });

  return { createOrder, receiveOrder, cancelOrder, correctStock };
}
