// Where code names the **name** of a token. The value lives in one place only, src/styles/tokens.css —
// write a value here and there are two copies, and in dark mode the two drift apart.
// When an inline style or an SVG has to name a color, call it as `token.color.accent`.
const v = (name: string): string => `var(--clds-${name})`;

export const token = {
  color: {
    canvas: v("color-canvas"),
    surface: v("color-surface"),
    subtle: v("color-subtle"),
    ink: v("color-ink"),
    inkDim: v("color-ink-dim"),
    inkFaint: v("color-ink-faint"),
    line: v("color-line"),
    accent: v("color-accent"),
    accentInk: v("color-accent-ink"),
    accentSoft: v("color-accent-soft"),
    navCurrent: v("color-nav-current"),
    navCurrentInk: v("color-nav-current-ink"),
    band: v("color-band"),
    bandInk: v("color-band-ink"),
    bandDim: v("color-band-dim"),
    positive: v("color-positive"),
    negative: v("color-negative"),
    problem: v("color-problem"),
  },
  radius: {
    sm: v("radius-sm"),
    md: v("radius-md"),
    lg: v("radius-lg"),
    xl: v("radius-xl"),
    xxl: v("radius-2xl"),
    pill: v("radius-pill"),
  },
  space: {
    1: v("space-1"),
    2: v("space-2"),
    3: v("space-3"),
    4: v("space-4"),
    5: v("space-5"),
    6: v("space-6"),
    7: v("space-7"),
    8: v("space-8"),
    9: v("space-9"),
    10: v("space-10"),
  },
  font: { sans: v("font-sans"), mono: v("font-mono") },
  shadow: { card: v("shadow-card") },
} as const;

// The narrow-screen breakpoint. Media queries cannot read CSS variables, so inside CSS it is a literal;
// a script that has to ask about the same boundary uses this value.
export const NARROW_BREAKPOINT_PX = 900;
