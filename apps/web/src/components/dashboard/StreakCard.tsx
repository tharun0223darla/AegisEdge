import { useNavigate } from 'react-router-dom';
import { Flame, ArrowRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { ROUTES } from '@/constants/app';
import type { DashboardSummary } from '@/types/dashboard';

interface StreakCardProps {
  summary?: DashboardSummary;
  isLoading?: boolean;
}

export function StreakCard({ summary, isLoading }: StreakCardProps) {
  const navigate = useNavigate();
  const days = summary?.currentStreak ?? 0;

  return (
    <Card
      interactive
      onClick={() => navigate(ROUTES.ANALYTICS)}
      className="cursor-pointer group hover:border-warning/40 transition-all h-full flex flex-col justify-center"
    >
      <CardContent className="flex items-center justify-between p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-warning-soft text-warning group-hover:scale-105 transition-transform">
            <Flame className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-text-muted">Current streak</p>
            {isLoading || !summary ? (
              <Skeleton className="mt-1 h-7 w-24" />
            ) : (
              <p className="text-2xl font-semibold text-text-primary">
                {days} <span className="text-sm font-normal text-text-muted">{days === 1 ? 'day' : 'days'}</span>
              </p>
            )}
            <p className="mt-0.5 text-xs text-text-muted">
              {days > 0 ? 'Keep it going!' : 'Log a dose to start a streak.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 text-xs font-semibold text-warning opacity-0 group-hover:opacity-100 transition-opacity">
          <span>Streak History</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </div>
      </CardContent>
    </Card>
  );
}
