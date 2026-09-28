/**
 * Aggregated design-system theme. Single import surface for non-Tailwind
 * consumers such as Framer Motion, Recharts, canvas, SVG, and inline styles.
 */

import type { Transition, Variants } from 'framer-motion';
import {
  chartPalette,
  chartTheme,
  colors,
  doseStatusColors,
  statusColors,
  statusSoftColors,
} from './colors';
import { fontFamilies, fontSizes, fontWeights, typography } from './typography';

export const radii = {
  sm: '0.375rem',
  md: '0.5rem',
  lg: '0.75rem',
  xl: '1rem',
  '2xl': '1.5rem',
  '4xl': '2rem',
  full: '9999px',
} as const;

export const shadows = {
  card: '0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 24px -8px rgba(0,0,0,0.5)',
  elevated:
    '0 1px 0 rgba(255,255,255,0.06) inset, 0 12px 32px -8px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)',
  glow: '0 0 0 1px rgba(52,216,176,0.2), 0 0 24px -4px rgba(52,216,176,0.35)',
  glowDanger:
    '0 0 0 1px rgba(248,113,113,0.25), 0 0 24px -4px rgba(248,113,113,0.35)',
} as const;

export const gradients = {
  radial: 'radial-gradient(ellipse at top, rgba(52,216,176,0.08), transparent 60%)',
  mesh: 'radial-gradient(at 20% 10%, rgba(52,216,176,0.12) 0px, transparent 50%), radial-gradient(at 80% 90%, rgba(96,165,250,0.10) 0px, transparent 50%)',
  brand: 'linear-gradient(135deg, #34D8B0 0%, #1FB893 100%)',
  card: 'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0) 100%)',
} as const;

export const glass = {
  panel: 'border border-border bg-surface backdrop-blur-xl shadow-card',
  raised: 'border border-border bg-surface-raised backdrop-blur-xl shadow-elevated',
  subtle: 'border border-border-subtle bg-surface-hover backdrop-blur-md',
} as const;

export const easing = {
  outExpo: [0.16, 1, 0.3, 1] as const,
  standard: [0.4, 0, 0.2, 1] as const,
};

export const durations = {
  fast: 0.18,
  base: 0.25,
  slow: 0.35,
} as const;

export const transitions: Record<'soft' | 'snappy' | 'spring', Transition> = {
  soft: {
    duration: durations.slow,
    ease: easing.outExpo,
  },
  snappy: {
    duration: durations.base,
    ease: easing.outExpo,
  },
  spring: {
    type: 'spring',
    stiffness: 320,
    damping: 30,
    mass: 0.8,
  },
};

export const motionVariants: Record<string, Variants> = {
  fadeIn: {
    hidden: {
      opacity: 0,
      y: 6,
    },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: durations.slow,
        ease: easing.outExpo,
      },
    },
  },
  fadeInUp: {
    hidden: {
      opacity: 0,
      y: 16,
    },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: durations.slow,
        ease: easing.outExpo,
      },
    },
  },
  scaleIn: {
    hidden: {
      opacity: 0,
      scale: 0.96,
    },
    visible: {
      opacity: 1,
      scale: 1,
      transition: {
        duration: durations.base,
        ease: easing.outExpo,
      },
    },
  },
  staggerContainer: {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: 0.06,
        delayChildren: 0.04,
      },
    },
  },
  listItem: {
    hidden: {
      opacity: 0,
      y: 12,
    },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: durations.base,
        ease: easing.outExpo,
      },
    },
  },
};

export const theme = {
  colors,
  statusColors,
  statusSoftColors,
  doseStatusColors,
  chartPalette,
  chartTheme,
  fontFamilies,
  fontWeights,
  fontSizes,
  typography,
  radii,
  shadows,
  gradients,
  glass,
  easing,
  durations,
  transitions,
  motionVariants,
} as const;

export type Theme = typeof theme;

export default theme;
