'use client';

import { useRef, type ReactNode } from 'react';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import { SPRING, riseIn, revealContainer, revealItem, springFor } from '@/lib/motion/springs';
import { cn } from '@/components/ui/core';

/**
 * Scroll-triggered reveals.
 *
 * `useInView` (backed by IntersectionObserver) replaces a scroll listener: the
 * browser does the work off the main thread, and the element renders only once
 * so nothing keeps observing after it has been seen.
 *
 * Every variant collapses to a static, fully-opaque state under reduced motion,
 * so the content is never hidden behind an animation that will not run.
 */

export function Reveal({ children, className, delay = 0, as = 'div' }: {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: 'div' | 'section' | 'li' | 'article';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const inView = useInView(ref, { once: true, margin: '0px 0px -12% 0px' });
  const variants = riseIn(reduceMotion);
  // Indexing `motion` with a variable intersects every tag's ref type, which no
  // single ref can satisfy. Narrowing to one concrete shape keeps the ref
  // assignment sound; React still attaches the real node for the rendered tag.
  const MotionTag = motion[as] as typeof motion.div;

  return (
    <MotionTag
      ref={ref}
      className={className}
      initial="hidden"
      animate={inView || reduceMotion ? 'show' : 'hidden'}
      variants={variants}
      transition={delay ? { delay } : undefined}
    >
      {children}
    </MotionTag>
  );
}

/** A list whose children rise in sequence. Pair with `RevealItem`. */
export function RevealList({ children, className, as = 'ul' }: {
  children: ReactNode;
  className?: string;
  as?: 'ul' | 'ol' | 'div';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const inView = useInView(ref, { once: true, margin: '0px 0px -10% 0px' });
  const MotionTag = motion[as] as typeof motion.div;

  return (
    <MotionTag
      ref={ref}
      className={className}
      initial="hidden"
      animate={inView || reduceMotion ? 'show' : 'hidden'}
      variants={revealContainer(reduceMotion)}
    >
      {children}
    </MotionTag>
  );
}

export function RevealItem({ children, className, as = 'li' }: {
  children: ReactNode;
  className?: string;
  as?: 'li' | 'div' | 'article';
}) {
  const reduceMotion = useReducedMotion();
  const MotionTag = motion[as];
  return (
    <MotionTag className={className} variants={revealItem(reduceMotion)}>
      {children}
    </MotionTag>
  );
}

/**
 * A magnetic wrapper for primary calls to action: the surface leans a few pixels
 * toward the pointer. Pointer-only, disabled for touch and reduced motion.
 */
export function Magnetic({ children, className, strength = 6 }: {
  children: ReactNode;
  className?: string;
  strength?: number;
}) {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);

  if (reduceMotion) return <div className={className}>{children}</div>;

  return (
    <motion.div
      ref={ref}
      className={cn('inline-flex', className)}
      onPointerMove={(event) => {
        // Coarse pointers get no magnetism: there is no resting cursor to react to.
        if (event.pointerType !== 'mouse') return;
        const node = ref.current;
        if (!node) return;
        const rect = node.getBoundingClientRect();
        const dx = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
        const dy = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
        node.style.transform = `translate3d(${(dx * strength).toFixed(2)}px, ${(dy * strength).toFixed(2)}px, 0)`;
      }}
      onPointerLeave={() => {
        const node = ref.current;
        if (node) node.style.transform = '';
      }}
      style={{ transition: 'transform 320ms cubic-bezier(0.16, 1, 0.3, 1)', willChange: 'transform' }}
    >
      {children}
    </motion.div>
  );
}

/**
 * A surface that lifts toward the pointer and settles back with a spring.
 *
 * Hover is a progressive enhancement, never a requirement: the card is fully
 * readable at rest, and the press compresses slightly so touch gets feedback
 * that a hover-only affordance would never deliver. Both are suppressed under
 * reduced motion, where the card is simply static.
 */
export function MotionCard({ children, className, as = 'div', ...rest }: {
  children: ReactNode;
  className?: string;
} & { as?: 'div' | 'article' | 'li' } & Record<string, unknown>) {
  const reduceMotion = useReducedMotion();
  const MotionTag = motion[as] as typeof motion.div;
  return (
    <MotionTag
      className={className}
      whileHover={reduceMotion ? undefined : { y: -2 }}
      whileTap={reduceMotion ? undefined : { scale: 0.995 }}
      transition={springFor(reduceMotion, SPRING)}
      {...rest}
    >
      {children}
    </MotionTag>
  );
}
