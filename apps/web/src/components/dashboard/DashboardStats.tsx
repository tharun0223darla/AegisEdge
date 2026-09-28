import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Activity, CalendarClock, Pill, Flame, ArrowUpRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { staggerContainer, fadeUp } from '@/animations/variants';
import { formatNumber } from '@/lib/utils';
import { ROUTES } from '@/constants/app';
import type { DashboardSummary } from '@/types/dashboard';

interface DashboardStatsProps {
  summary?: DashboardSummary;
  isLoading?: boolean;
}

export function DashboardStats({ summary, isLoading }: DashboardStatsProps) {
  const navigate = useNavigate();

  const stats = [
    {
      key: 'adherence',
      label: 'Adherence',
      icon: Activity,
      suffix: '%',
      value: summary?.today.completionPercent,
      route: ROUTES.ANALYTICS,
    },
    {
      key: 'medicines',
      label: 'Active medicines',
      icon: Pill,
      suffix: '',
      value: summary?.activeMedicines,
      route: ROUTES.MEDICINES,
    },
    {
      key: 'upcoming',
      label: 'Upcoming doses',
      icon: CalendarClock,
      suffix: '',
      value: summary?.today.pending,
      route: ROUTES.DOSE_LOGS,
    },
    {
      key: 'streak',
      label: 'Day streak',
      icon: Flame,
      suffix: 'd',
      value: summary?.currentStreak,
      route: ROUTES.ANALYTICS,
    },
  ];

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="grid grid-cols-2 gap-4 lg:grid-cols-4"
    >
      {stats.map(({ key, label, icon: Icon, suffix, value, route }) => (
        <motion.div key={key} variants={fadeUp}>
          <Card
            interactive
            onClick={() => navigate(route)}
            className="cursor-pointer group hover:border-brand-500/40 transition-all"
          >
            <CardContent className="flex items-center justify-between p-5">
              <div className="flex items-center gap-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500/12 text-brand-400 group-hover:bg-brand-500/20 group-hover:text-brand-300 transition-colors">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-text-muted">{label}</p>
                  {isLoading || !summary ? (
                    <Skeleton className="mt-1 h-6 w-16" />
                  ) : (
                    <p className="text-xl font-semibold text-text-primary">
                      {formatNumber(value ?? 0)}
                      {suffix && <span className="text-sm text-text-muted">{suffix}</span>}
                    </p>
                  )}
                </div>
              </div>

              <ArrowUpRight className="h-4 w-4 text-text-muted opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all shrink-0" />
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </motion.div>
  );
}
