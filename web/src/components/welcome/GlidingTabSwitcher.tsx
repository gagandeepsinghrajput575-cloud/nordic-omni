'use client';

import type { ReactNode } from 'react';
import { SegmentedControl } from '@/components/ui/glass';

/**
 * The gliding mode selector.
 *
 * This is a thin, product-level wrapper over `SegmentedControl` rather than a
 * second pill implementation: the glide is a shared-layout element
 * (`layoutId`) on the one shared `SPRING`, and every option is a real
 * `role="tab"` with `aria-selected`. Re-implementing it here would have meant
 * two curved thumbs that could drift apart.
 *
 * Keyboard: `SegmentedControl` renders native buttons, so Tab and Enter/Space
 * work without a bespoke key handler.
 */

export interface TabOption<T extends string> {
  value: T;
  label: string;
  /** Monochrome glyph. Never a chromatic dot — the palette is 8 literals. */
  icon?: ReactNode;
}

export interface GlidingTabSwitcherProps<T extends string> {
  options: ReadonlyArray<TabOption<T>>;
  value: T;
  onChange: (next: T) => void;
  /** Accessible name for the tablist, e.g. "Studio mode". */
  label: string;
  className?: string;
}

export function GlidingTabSwitcher<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: GlidingTabSwitcherProps<T>) {
  return (
    <SegmentedControl
      options={options}
      value={value}
      onChange={onChange}
      label={label}
      className={className}
    />
  );
}
