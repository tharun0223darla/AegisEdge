import { type ReactNode } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';

interface ChartCardProps {
  title: string;
  description?: string;
  isLoading?: boolean;
  isEmpty?: boolean;
  emptyLabel?: string;
  action?: ReactNode;
  height?: number;
  children: ReactNode;
}

/** Consistent wrapper for every analytics chart: title, loading + empty states. */
export function ChartCard({
  title,
  description,
  isLoading = false,
  isEmpty = false,
  emptyLabel = 'No data yet',
  action,
  height = 280,
  children,
}: ChartCardProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <div className="flex flex-col gap-1">
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {action}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="w-full" style={{ height }} />
        ) : isEmpty ? (
          <EmptyState title={emptyLabel} className="border-none py-10" />
        ) : (
          <div style={{ height }}>{children}</div>
        )}
      </CardContent>
    </Card>
  );
}
