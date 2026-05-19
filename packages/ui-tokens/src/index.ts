/**
 * Baxter Design Tokens
 *
 * Single source of truth for color, spacing, and motion.
 * Editorial Constitution: atmosphere is the moat.
 *
 * Typography axes live alongside font loading in apps/web/app/layout.tsx
 * (Fraunces variable: opsz 24, SOFT 50; DM Sans as DIN proxy).
 */

export const color = {
  /** Warm off-white — primary surface. Never pure white. */
  canvas: '#f5f3ee',
  /** Near-black for body text. Never pure black. */
  ink: '#1a1a1a',
  /** 72% ink — secondary text, metadata labels. */
  inkSoft: 'rgba(26, 26, 26, 0.72)',
  /** 50% ink — tertiary, captions, deemphasized. */
  inkFaint: 'rgba(26, 26, 26, 0.5)',
  /** 12% ink — hairline rules. */
  rule: 'rgba(26, 26, 26, 0.12)',
  /** Deep oxblood. Used sparingly — submission accents, key actions only. */
  accent: '#8a2820',
} as const;

export const layout = {
  /** Page gutters: ~12–14% viewport, min 60px. */
  gutter: 'clamp(60px, 12vw, 180px)',
  /** Body paragraph cap — 60–70 character measure. */
  measureMaxPx: 620,
  /** Headlines hold at half page width or less. */
  headlineMaxPercent: 50,
  /** Metadata column. */
  metadataMaxPx: 360,
} as const;

export const motion = {
  /** All transitions move through this curve. No bounce, no overshoot. */
  easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
  /** Short, considered hover changes. */
  durationFast: '400ms',
  /** Page-level transitions, section reveals. */
  durationSlow: '600ms',
} as const;

export const type = {
  /** Body settles at 18px / 1.65. */
  bodyPx: 18,
  bodyLineHeight: 1.65,
  /** Fraunces optical-size and softness when used as a variable font. */
  frauncesAxes: { opsz: 24, SOFT: 50 } as const,
} as const;

export type Color = keyof typeof color;
