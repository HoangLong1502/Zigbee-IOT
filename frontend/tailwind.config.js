/** @type {import('tailwindcss').Config} */
const rgb = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: rgb('--c-ink'),
        surface: {
          50: rgb('--c-surface-50'),
          100: rgb('--c-surface-100'),
          200: rgb('--c-surface-200'),
          300: rgb('--c-surface-300'),
          700: rgb('--c-surface-700'),
          800: rgb('--c-surface-800'),
          900: rgb('--c-surface-900'),
          950: rgb('--c-surface-950'),
        },
        slate: {
          50: rgb('--c-slate-50'),
          100: rgb('--c-slate-100'),
          200: rgb('--c-slate-200'),
          300: rgb('--c-slate-300'),
          400: rgb('--c-slate-400'),
          500: rgb('--c-slate-500'),
          600: rgb('--c-slate-600'),
          700: rgb('--c-slate-700'),
          800: rgb('--c-slate-800'),
          900: rgb('--c-slate-900'),
        },
        accent: {
          DEFAULT: rgb('--c-accent'),
          soft: rgb('--c-accent-soft'),
          muted: rgb('--c-accent-muted'),
        },
        success: rgb('--c-success'),
        warning: rgb('--c-warning'),
        danger: rgb('--c-danger'),
      },
      boxShadow: {
        card: 'var(--shadow-card)',
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
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
