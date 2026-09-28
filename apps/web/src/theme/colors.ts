/**
 * Canonical color tokens mirrored from tailwind.config.js.
 * Use these where Tailwind classes can't reach: Recharts, Framer Motion,
 * canvas/SVG fills, and dynamic inline styles. Keep in sync with Tailwind.
 */

export const colors = {
  bg: {
    base: '#0A0E1A',
    elevated: '#0F1422',
    overlay: '#141A2B',
    inset: '#080B14',
  },
  surface: {
    DEFAULT: 'rgba(15, 20, 34, 0.7)',
    solid: '#0F1422',
    raised: '#161D30',
    hover: 'rgba(255, 255, 255, 0.04)',
  },
  border: {
    subtle: 'rgba(255, 255, 255, 0.06)',
    DEFAULT: 'rgba(255, 255, 255, 0.10)',
    strong: 'rgba(255, 255, 255, 0.16)',
  },
  text: {
    primary: '#E6EAF2',
    secondary: '#B6BECD',
    muted: '#8A93A6',
    faint: '#5B6478',
    inverse: '#0A0E1A',
  },
  brand: {
    50: '#E8FBF5',
    100: '#C5F4E5',
    200: '#8FE8CC',
    300: '#5EDBB4',
    400: '#3FCFA1',
    500: '#34D8B0',
    600: '#1FB893',
    700: '#168F73',
    800: '#0F6856',
    900: '#093F35',
  },
  accent: {
    50: '#EFF6FF',
    100: '#DBEAFE',
    400: '#60A5FA',
    500: '#3B82F6',
    600: '#2563EB',
  },
  success: {
    DEFAULT: '#34D399',
    soft: 'rgba(52, 211, 153, 0.12)',
  },
  warning: {
    DEFAULT: '#FBBF24',
    soft: 'rgba(251, 191, 36, 0.12)',
  },
  danger: {
    DEFAULT: '#F87171',
    soft: 'rgba(248, 113, 113, 0.12)',
  },
  info: {
    DEFAULT: '#60A5FA',
    soft: 'rgba(96, 165, 250, 0.12)',
  },
} as const;

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'muted';

export const statusColors: Record<StatusTone, string> = {
  success: colors.success.DEFAULT,
  warning: colors.warning.DEFAULT,
  danger: colors.danger.DEFAULT,
  info: colors.info.DEFAULT,
  accent: colors.brand[500],
  muted: colors.text.muted,
};

export const statusSoftColors: Record<StatusTone, string> = {
  success: colors.success.soft,
  warning: colors.warning.soft,
  danger: colors.danger.soft,
  info: colors.info.soft,
  accent: 'rgba(52, 216, 176, 0.12)',
  muted: 'rgba(138, 147, 166, 0.12)',
};

export const doseStatusColors = {
  TAKEN: colors.success.DEFAULT,
  MISSED: colors.danger.DEFAULT,
  SNOOZED: colors.warning.DEFAULT,
  SKIPPED: colors.text.muted,
  PENDING: colors.brand[500],
} as const;

export const chartPalette = [
  colors.brand[500],
  colors.accent[500],
  colors.warning.DEFAULT,
  colors.danger.DEFAULT,
  colors.brand[300],
  colors.info.DEFAULT,
] as const;

export const chartTheme = {
  grid: colors.border.subtle,
  axis: colors.text.faint,
  axisLabel: colors.text.muted,
  tooltipBg: colors.bg.overlay,
  tooltipBorder: colors.border.DEFAULT,
  tooltipText: colors.text.primary,
  cursor: 'rgba(255, 255, 255, 0.04)',
} as const;

export type ColorTokens = typeof colors;
