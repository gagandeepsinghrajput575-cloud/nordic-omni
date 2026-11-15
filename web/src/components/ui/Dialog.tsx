'use client';

import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { useFocusTrap } from './overlay';
import { buttonClass } from './form';
import { modalIn, modalOut, modalRest } from '@/lib/motion/springs';

export function Dialog({ open, onClose, title, description, children, footer, wide = false }: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useFocusTrap(ref, open, onClose);
  const reduceMotion = useReducedMotion();
  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div className="overlay-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0 : 0.16 }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${id}-title`}
            aria-describedby={description ? `${id}-description` : undefined}
            tabIndex={-1}
            className="modal-panel"
            style={{ maxWidth: wide ? 720 : 540 }}
            initial={modalIn(reduceMotion)}
            animate={modalRest(reduceMotion)}
            exit={modalOut(reduceMotion)}
          >
            <div className="modal-header">
              <div>
                <h2 id={`${id}-title`} className="text-lg font-semibold tracking-[-0.03em]">{title}</h2>
                {description ? <p id={`${id}-description`} className="mt-1.5 text-[13px] leading-5 text-[var(--muted)]">{description}</p> : null}
              </div>
              <button type="button" onClick={onClose} className={buttonClass('ghost', 'sm', 'icon-button')} aria-label="Close dialog"><X size={17} /></button>
            </div>
            <div className="modal-body">{children}</div>
            {footer ? <div className="modal-footer">{footer}</div> : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
