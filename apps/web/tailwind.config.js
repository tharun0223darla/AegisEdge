/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ── Surface system ────────────────────────────────
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
        // ── Brand ─────────────────────────────────────────
        brand: {
          50: '#E8FBF5',
          100: '#C5F4E5',
          200: '#8FE8CC',
          300: '#5EDBB4',
          400: '#3FCFA1',
          500: '#34D8B0', // primary
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
        success: { DEFAULT: '#34D399', soft: 'rgba(52, 211, 153, 0.12)' },
        warning: { DEFAULT: '#FBBF24', soft: 'rgba(251, 191, 36, 0.12)' },
        danger: { DEFAULT: '#F87171', soft: 'rgba(248, 113, 113, 0.12)' },
        info: { DEFAULT: '#60A5FA', soft: 'rgba(96, 165, 250, 0.12)' },
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: {
        '4xl': '2rem',
      },
      boxShadow: {
        card: '0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 24px -8px rgba(0,0,0,0.5)',
        elevated:
          '0 1px 0 rgba(255,255,255,0.06) inset, 0 12px 32px -8px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)',
        glow: '0 0 0 1px rgba(52,216,176,0.2), 0 0 24px -4px rgba(52,216,176,0.35)',
        'glow-danger': '0 0 0 1px rgba(248,113,113,0.25), 0 0 24px -4px rgba(248,113,113,0.35)',
      },
      backgroundImage: {
        'gradient-radial':
          'radial-gradient(ellipse at top, rgba(52,216,176,0.08), transparent 60%)',
        'gradient-mesh':
          'radial-gradient(at 20% 10%, rgba(52,216,176,0.12) 0px, transparent 50%), radial-gradient(at 80% 90%, rgba(96,165,250,0.10) 0px, transparent 50%)',
        'gradient-brand': 'linear-gradient(135deg, #34D8B0 0%, #1FB893 100%)',
        'gradient-card':
          'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0) 100%)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(52,216,176,0.4)' },
          '50%': { boxShadow: '0 0 0 10px rgba(52,216,176,0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.35s ease-out both',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        shimmer: 'shimmer 1.6s linear infinite',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
};
