export interface DashboardSummary {
  today: {
    date: string;
    total: number;
    taken: number;
    pending: number;
    missed: number;
    snoozed: number;
    skipped: number;
    completionPercent: number;
  };
  week: {
    adherencePercent: number;
    taken: number;
    missed: number;
    total: number;
  };
  nextDose: {
    id: string;
    medicineName: string;
    medicineForm: string;
    strength: string | null;
    scheduledAt: string;
    minutesUntil: number;
  } | null;
  activeMedicines: number;
  activeSchedules: number;
  lowStockAlerts: { id: string; name: string; remainingQuantity: number | null; form: string }[];
  currentStreak: number;
  riskLevel: string;
  disclaimer: string;
}

/** One data point from GET /dashboard/trends — the `.trend[]` array */
export interface AdherencePoint {
  date: string;          // ISO date yyyy-MM-dd
  adherencePercent: number;
  taken: number;
  missed: number;
  streak: number;
  riskLevel: string;
}

/** One entry from GET /dashboard/adherence — the `.medicines[]` array */
export interface StatusBreakdown {
  medicineId: string;
  medicineName: string;
  medicineForm: string;
  strength: string | null;
  totalDoses: number;
  taken: number;
  missed: number;
  snoozed: number;
  skipped: number;
  adherencePercent: number;
  progressIndicator: unknown;
}
