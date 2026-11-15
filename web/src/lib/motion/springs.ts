/**
 * One motion vocabulary for the whole product.
 *
 * Every spring used by a component resolves from here so a hover, a tab
 * indicator and a nav tile all feel like the same hand. The curves match
 * `--el-spring` in globals.css, which drives the CSS-only transitions.
 *
 * Reduced motion is never assumed away: callers pass `useReducedMotion()` into
 * `springFor`, which returns a zero-duration transition so the element snaps to
 * its final state instead of travelling there.
 */

export type SpringPreset = { type: 'spring'; stiffness: number; damping: number; mass?: number };

/** The default. Quick, settled, no visible overshoot. */
export const SPRING: SpringPreset = { type: 'spring', stiffness: 420, damping: 34, mass: 0.7 };

/** Softer, for large surfaces where a stiff spring reads as a jolt. */
export const SPRING_SOFT: SpringPreset = { type: 'spring', stiffness: 260, damping: 28 };

/** Snappier, for small objects like the play/pause morph. */
export const SPRING_SNAP: SpringPreset = { type: 'spring', stiffness: 620, damping: 30, mass: 0.6 };

/** A visible settle, used for drawers and sheets. */
export const SPRING_DRAWER: SpringPreset = { type: 'spring', stiffness: 320, damping: 34 };

/** Fades and small offsets: tween, because a spring here would read as a wobble. */
export const EASE_OUT = { duration: 0.28, ease: [0.16, 1, 0.3, 1] } as const;

/**
 * Returns the preset unchanged, or a zero-duration transition when the visitor
 * asked for reduced motion. Every animated component routes through this.
 */
export function springFor(reduceMotion: boolean | null, preset: SpringPreset = SPRING) {
  return reduceMotion ? ({ duration: 0 } as const) : preset;
}

/** Stagger children of a list. Collapses to 0 under reduced motion. */
export function staggerFor(reduceMotion: boolean | null, step = 0.045, delayChildren = 0.05) {
  return reduceMotion
    ? ({ staggerChildren: 0, delayChildren: 0 } as const)
    : ({ staggerChildren: step, delayChildren } as const);
}

/**
 * A list container: children ride up into place, in sequence. The variants are
 * plain objects so they can be spread into any `motion.*` element.
 */
export const revealContainer = (reduceMotion: boolean | null) => ({
  hidden: {},
  show: { transition: staggerFor(reduceMotion) },
});

export const revealItem = (reduceMotion: boolean | null) => ({
  hidden: reduceMotion ? { opacity: 1 } : { opacity: 0, y: 14 },
  show: {
    opacity: 1,
    y: 0,
    transition: springFor(reduceMotion, SPRING_SOFT),
  },
});

/** A single surface entering the viewport: no stagger, just a rise. */
export const riseIn = (reduceMotion: boolean | null) => ({
  hidden: reduceMotion ? { opacity: 1 } : { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: springFor(reduceMotion, SPRING_SOFT) },
});
