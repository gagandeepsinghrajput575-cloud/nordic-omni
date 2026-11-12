'use client';

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Native-quality focus containment, escape handling and scroll locking for portals. */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => {
      const first = ref.current?.querySelector<HTMLElement>('[data-autofocus]')
        ?? ref.current?.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? ref.current)?.focus();
    });

    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== 'Tab' || !ref.current) return;
      const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((item) => item.getClientRects().length > 0 && !item.closest('[hidden]'));
      if (!items.length) { event.preventDefault(); ref.current.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !ref.current.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !ref.current.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', keydown);
      document.body.style.overflow = oldOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [active, ref]);
}
