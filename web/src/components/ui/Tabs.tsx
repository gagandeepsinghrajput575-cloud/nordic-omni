'use client';

import { useId, useRef, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cn } from './core';

export interface TabItem<T extends string> { id: T; label: string; icon?: ReactNode }

/** Accessible tabs with roving focus and a shared spring indicator. */
export function Tabs<T extends string>({ id, items, value, onChange, label, className }: {
  id: string;
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  const motionId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div className={cn('tabs', className)} role="tablist" aria-label={label}>
      {items.map((item, index) => (
        <button
          key={item.id}
          ref={(node) => { refs.current[index] = node; }}
          type="button"
          role="tab"
          id={`${id}-tab-${item.id}`}
          aria-controls={`${id}-panel-${item.id}`}
          aria-selected={value === item.id}
          tabIndex={value === item.id ? 0 : -1}
          className="tab-trigger"
          onClick={() => onChange(item.id)}
          onKeyDown={(event) => {
            let next = index;
            if (event.key === 'ArrowRight') next = (index + 1) % items.length;
            else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = items.length - 1;
            else return;
            event.preventDefault();
            onChange(items[next].id);
            refs.current[next]?.focus();
            refs.current[next]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          }}
        >
          {item.icon}
          {item.label}
          {value === item.id ? <motion.span className="tab-indicator" layoutId={`tab-${motionId}`} transition={{ type: 'spring', stiffness: 430, damping: 36 }} aria-hidden /> : null}
        </button>
      ))}
    </div>
  );
}

export function tabPanelProps<T extends string>(id: string, active: T, panel: T) {
  return {
    id: `${id}-panel-${panel}`,
    'aria-labelledby': `${id}-tab-${panel}`,
    role: 'tabpanel' as const,
    hidden: active !== panel,
    tabIndex: 0,
  };
}
