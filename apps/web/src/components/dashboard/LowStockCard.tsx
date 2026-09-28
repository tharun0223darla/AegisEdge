import { useNavigate } from 'react-router-dom';
import { PackageX, ArrowRight, ShoppingCart } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { ROUTES } from '@/constants/app';
import type { Medicine } from '@/types/medicine';

interface LowStockCardProps {
  medicines?: Medicine[];
  isLoading?: boolean;
}

export function LowStockCard({ medicines, isLoading }: LowStockCardProps) {
  const navigate = useNavigate();
  const items = (medicines ?? []).slice(0, 5);

  return (
    <Card className="flex flex-col justify-between">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <PackageX className="h-4 w-4 text-warning" /> Low stock
        </CardTitle>
        <button
          type="button"
          onClick={() => navigate(ROUTES.REFILLS)}
          className="inline-flex items-center gap-1 text-xs font-semibold text-warning hover:text-amber-300 transition-colors"
        >
          <span>Refills</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)
        ) : items.length === 0 ? (
          <div className="text-center py-6">
            <EmptyState
              title="Stock looks good"
              description="No medicines below their refill threshold."
              className="border-none py-2"
            />
            <button
              type="button"
              onClick={() => navigate(ROUTES.REFILLS)}
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border bg-surface text-xs font-semibold text-text-primary hover:bg-surface-hover hover:border-warning/40 transition-colors"
            >
              <span>Manage Refills & Pharmacy</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          items.map((m) => (
            <div
              key={m.id}
              onClick={() => navigate(ROUTES.REFILLS)}
              className="flex items-center justify-between rounded-xl border border-border bg-surface-raised px-3 py-2.5 hover:border-warning/40 hover:bg-surface-hover cursor-pointer transition-all group"
            >
              <div>
                <p className="text-sm font-medium text-text-primary group-hover:text-warning transition-colors">{m.name}</p>
                <p className="text-xs text-text-muted">
                  {m.stockQuantity} {m.unit ?? 'left'}
                  {m.refillThreshold != null && ` · threshold ${m.refillThreshold}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={m.stockQuantity === 0 ? 'danger' : 'warning'} dot>
                  {m.stockQuantity === 0 ? 'Out' : 'Low'}
                </Badge>
                <span className="p-1 rounded-lg bg-warning/10 text-warning group-hover:bg-warning group-hover:text-black transition-colors" title="Refill Medicine">
                  <ShoppingCart className="h-3.5 w-3.5" />
                </span>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
