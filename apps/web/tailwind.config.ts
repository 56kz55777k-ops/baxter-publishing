import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    '../../packages/ui-tokens/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--canvas)',
        ink: 'var(--ink)',
        'ink-soft': 'var(--ink-soft)',
        'ink-faint': 'var(--ink-faint)',
        rule: 'var(--rule)',
        accent: 'var(--accent)',
      },
      fontFamily: {
        // DIN proxy — DM Sans in shell, navigation, metadata
        sans: ['var(--font-din-proxy)', 'system-ui', 'sans-serif'],
        // Fraunces — literary body and editorial headlines
        serif: ['var(--font-fraunces)', 'Georgia', 'serif'],
      },
      fontSize: {
        // Body settles at 18px / 1.65 — covered by base layer
        'metadata': ['0.75rem', { lineHeight: '1.4', letterSpacing: '0.08em' }],
        'caption': ['0.8125rem', { lineHeight: '1.5' }],
        'body': ['1.125rem', { lineHeight: '1.65' }],
        'lede': ['1.375rem', { lineHeight: '1.55' }],
        'h3': ['1.625rem', { lineHeight: '1.3' }],
        'h2': ['2.25rem', { lineHeight: '1.2' }],
        'h1': ['3.5rem', { lineHeight: '1.05' }],
        'display': ['4.75rem', { lineHeight: '1.0' }],
      },
      spacing: {
        gutter: 'clamp(60px, 12vw, 180px)',
      },
      maxWidth: {
        measure: '38.75rem',  // ~620px body cap
        headline: '50%',
        metadata: '22.5rem',  // 360px
      },
      transitionTimingFunction: {
        gentle: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
      },
      transitionDuration: {
        '400': '400ms',
        '600': '600ms',
      },
    },
  },
  plugins: [],
};

export default config;
