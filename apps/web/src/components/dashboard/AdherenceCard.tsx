import { useNavigate } from 'react-router-dom';
import { ArrowRight, BarChart2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { Badge } from '@/components/ui/Badge';
import { clamp } from '@/lib/utils';
import { ROUTES } from '@/constants/app';
import type { DashboardSummary } from '@/types/dashboard';

interface AdherenceCardProps {
  summary?: DashboardSummary;
  isLoading?: boolean;
}

function toneFor(rate: number) {
  if (rate >= 85) return { tone: 'success' as const, label: 'On track' };
  if (rate >= 60) return { tone: 'warning' as const, label: 'Needs attention' };
  return { tone: 'danger' as const, label: 'At risk' };
}

export function AdherenceCard({ summary, isLoading }: AdherenceCardProps) {
  const navigate = useNavigate();
  // Use week adherence for the ring, today's stats for the breakdown
  const rate = clamp(summary?.week.adherencePercent ?? 0, 0, 100);
  const meta = toneFor(rate);
  const circumference = 2 * Math.PI * 42;
  const offset = circumference - (rate / 100) * circumference;

  return (
    <Card className="flex flex-col justify-between">
      <CardHeader className="flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <CardTitle>Adherence rate</CardTitle>
          {!isLoading && summary && (
            <Badge tone={meta.tone} dot>
              {meta.label}
            </Badge>
          )}
        </div>

        <button
          type="button"
          onClick={() => navigate(ROUTES.ANALYTICS)}
          className="inline-flex items-center gap-1 text-xs font-semibold text-brand-400 hover:text-brand-300 transition-colors"
        >
          <span>Analytics</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </CardHeader>
      <CardContent className="flex items-center gap-6">
        {isLoading || !summary ? (
          <Skeleton rounded="full" className="h-28 w-28" />
        ) : (
          <div className="relative h-28 w-28 shrink-0">
            <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(148,163,184,0.15)" strokeWidth="8" />
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                className="text-brand-500 transition-all duration-700 ease-out"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-2xl font-semibold text-text-primary">{Math.round(rate)}%</span>
            </div>
          </div>
        )}
        <div className="flex flex-col gap-2 text-sm flex-1">
          <div className="flex items-center justify-between gap-6">
            <span className="text-text-muted">Taken today</span>
            <span className="font-medium text-success">{summary?.today.taken ?? '—'}</span>
          </div>
          <div className="flex items-center justify-between gap-6">
            <span className="text-text-muted">Missed today</span>
            <span className="font-medium text-danger">{summary?.today.missed ?? '—'}</span>
          </div>
          <div className="flex items-center justify-between gap-6">
            <span className="text-text-muted">Pending</span>
            <span className="font-medium text-text-primary">{summary?.today.pending ?? '—'}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
