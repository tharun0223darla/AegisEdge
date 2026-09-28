/**
 * Typography tokens mirrored from tailwind.config.js fontFamily,
 * plus a semantic type scale and reusable Tailwind class presets.
 */

export const fontFamilies = {
  sans: [
    'Inter',
    'ui-sans-serif',
    'system-ui',
    '-apple-system',
    'Segoe UI',
    'Roboto',
    'sans-serif',
  ].join(', '),
  mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'].join(', '),
} as const;

export const fontWeights = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

export const fontSizes = {
  '2xs': '0.6875rem',
  xs: '0.75rem',
  sm: '0.875rem',
  base: '1rem',
  lg: '1.125rem',
  xl: '1.25rem',
  '2xl': '1.5rem',
  '3xl': '1.875rem',
  '4xl': '2.25rem',
} as const;

export const typography = {
  display: 'text-4xl font-bold tracking-tight text-text-primary',
  h1: 'text-3xl font-bold tracking-tight text-text-primary',
  h2: 'text-2xl font-semibold tracking-tight text-text-primary',
  h3: 'text-xl font-semibold text-text-primary',
  h4: 'text-lg font-semibold text-text-primary',
  subtitle: 'text-sm font-medium text-text-secondary',
  body: 'text-sm text-text-secondary',
  bodyLg: 'text-base text-text-secondary',
  caption: 'text-xs text-text-muted',
  overline: 'text-2xs font-semibold uppercase tracking-wider text-text-faint',
  label: 'text-sm font-medium text-text-primary',
  mono: 'font-mono text-sm text-text-secondary',
  link: 'text-brand-500 transition-colors hover:text-brand-400',
} as const;

export type TypographyPreset = keyof typeof typography;
