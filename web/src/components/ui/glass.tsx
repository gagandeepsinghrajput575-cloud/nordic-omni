'use client';

import { useId, useMemo, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { SPRING, SPRING_SOFT } from '@/lib/motion/springs';

/**
 * ElevenLabs-style tactile primitives.
 *
 * These live in their own client module rather than inside `primitives.tsx`,
 * because that file is imported by server components and must stay hook-free.
 * Splitting them keeps the server surface untouched while giving the glass
 * controls the spring physics they need.
 *
 * Contrast: every ink here comes from the `--el-*` layer, whose values are
 * asserted against all three elevations in `showcase-elevenlabs.test.ts`.
 */

/**
 * The spring vocabulary is not redeclared here.
 *
 * `lib/motion/springs.ts` is the single source of truth; this module re-exports
 * rather than restating the literals, so a change to the curve can never leave
 * the glass controls drifting away from the rest of the product.
 */
export { SPRING, SPRING_SOFT };

// -----------------------------------------------------------------------------
// GlassButton
// -----------------------------------------------------------------------------

export type GlassButtonVariant = 'primary' | 'ghost' | 'outline';
export type GlassButtonSize = 'sm' | 'md' | 'lg';

/**
 * Motion redefines the drag/animation handlers with its own signatures, so the
 * native ones are omitted rather than merged — otherwise the whole prop bag
 * becomes unassignable to `HTMLMotionProps<'button'>`.
 */
type MotionSafeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onDrag' | 'onDragStart' | 'onDragEnd' | 'onDragEnter' | 'onDragExit' | 'onDragLeave' | 'onDragOver'
  | 'onDrop' | 'onAnimationStart' | 'onAnimationEnd' | 'onAnimationIteration'
>;

export interface GlassButtonProps extends MotionSafeButtonProps {
  variant?: GlassButtonVariant;
  size?: GlassButtonSize;
  icon?: ReactNode;
  children?: ReactNode;
}

const VARIANT_CLASS: Record<GlassButtonVariant, string> = {
  primary:
    'border-[color-mix(in_srgb,var(--el-accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--el-accent)_18%,transparent)] text-[var(--el-ink)]',
  ghost: 'border-transparent bg-transparent text-[var(--el-ink-secondary)] hover:text-[var(--el-ink)]',
  outline: 'border-[var(--el-line-strong)] bg-[color-mix(in_srgb,var(--el-elevated)_60%,transparent)] text-[var(--el-ink)]',
};

const SIZE_CLASS: Record<GlassButtonSize, string> = {
  sm: 'min-h-[32px] px-3 text-[12px] gap-1.5',
  md: 'min-h-[40px] px-4 text-[13px] gap-2',
  lg: 'min-h-[46px] px-5 text-[14px] gap-2',
};

/**
 * A frosted glass button with a spring hover lift.
 *
 * The lift is a transform on press/hover only and is disabled wholesale under
 * `prefers-reduced-motion`, where the button still changes colour so the hover
 * and press states remain perceivable without movement.
 */
export function GlassButton({
  children,
  variant = 'outline',
  size = 'md',
  icon,
  className,
  disabled,
  ...props
}: GlassButtonProps) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.button
      type="button"
      disabled={disabled}
      whileHover={reduceMotion || disabled ? undefined : { scale: 1.025, y: -1 }}
      whileTap={reduceMotion || disabled ? undefined : { scale: 0.975 }}
      transition={SPRING}
      className={[
        'inline-flex items-center justify-center rounded-full border font-medium',
        'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--el-accent)]',
        SIZE_CLASS[size],
        VARIANT_CLASS[variant],
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {icon ? <span className="shrink-0" aria-hidden>{icon}</span> : null}
      {children}
    </motion.button>
  );
}

// -----------------------------------------------------------------------------
// SegmentedControl
// -----------------------------------------------------------------------------

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (next: T) => void;
  label: string;
  className?: string;
}

/**
 * A tactile segmented pill slider.
 *
 * The moving thumb is a shared-layout element (`layoutId`), so it physically
 * glides between options instead of cross-fading. Each option is a real
 * `role="tab"` with `aria-selected`, which is what the test suite asserts.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: SegmentedControlProps<T>) {
  const reduceMotion = useReducedMotion();
  const layoutId = `segment-${useId()}`;

  return (
    <div
      role="tablist"
      aria-label={label}
      className={`el-segment ${className ?? ''}`.trim()}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={option.label}
            onClick={() => onChange(option.value)}
            className="el-segment-button"
          >
            {/* Shared layout moves the single thumb between options, so the
                glide is real interpolation rather than a per-item fade. */}
            {selected ? (
              <motion.span
                layoutId={layoutId}
                className="el-segment-track"
                transition={reduceMotion ? { duration: 0 } : SPRING}
                aria-hidden
              />
            ) : null}
            {option.icon ? <span className="relative z-[1] shrink-0" aria-hidden>{option.icon}</span> : null}
            <span className="relative z-[1]">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// -----------------------------------------------------------------------------
// EqualizerBadge
// -----------------------------------------------------------------------------

export interface EqualizerBadgeProps {
  active?: boolean;
  bars?: number;
  /** Shown beside the bars so the state never depends on animation alone. */
  label?: string;
  className?: string;
}

/**
 * A tiny equalizer, used as an "audio is live" badge.
 *
 * Small enough to sit inline with text. When `active` is false the bars freeze
 * in a low silhouette and `aria-hidden` keeps a decorative spinner out of the
 * accessibility tree; the optional `label` supplies the text equivalent.
 */
export function EqualizerBadge({ active = true, bars = 4, label, className }: EqualizerBadgeProps) {
  const count = Math.max(2, Math.min(9, Math.round(bars)));
  const reduceMotion = useReducedMotion();
  const heights = useMemo(
    () => Array.from({ length: count }, (_, index) => 45 + ((index * 37) % 55)),
    [count],
  );

  return (
    <span className={`inline-flex items-center gap-1.5 ${className ?? ''}`.trim()}>
      <span
        className="el-eq"
        data-active={active && !reduceMotion ? 'true' : 'false'}
        aria-hidden
      >
        {heights.map((height, index) => (
          <span
            key={index}
            style={{
              height: `${height}%`,
              animationDelay: `${(index % 4) * 120}ms`,
              animationDuration: `${900 + (index % 3) * 130}ms`,
            }}
          />
        ))}
      </span>
      {label ? <span className="text-[11px] font-medium text-[var(--el-ink-secondary)]">{label}</span> : null}
    </span>
  );
}
