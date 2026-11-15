'use client';

import type { ReactNode } from 'react';
import { FOOTER_COLUMNS } from './welcome-content';

/**
 * The conversion footer.
 *
 * A CTA banner, four link columns, and a base row carrying the copyright and a
 * platform status indicator.
 *
 * The status dot is green because it is the shared `--dot-online` token, and it
 * is always paired with the word "Operationel" — the colour is reinforcement,
 * never the signal. It reports the status of the *deployed platform*, which is
 * a static claim in this build; nothing here polls.
 *
 * The gradient CTA is `--primary-bg`: `linear-gradient(180deg, #ffffff,
 * #e8e8ee)` in dark and `#09090b` in light, which is exactly what the brief
 * specifies. Using the token keeps it correct in both themes.
 */


export interface WelcomeFooterProps {
  /** Year shown in the copyright. Injected so the render stays deterministic. */
  year?: number;
  className?: string;
}

export function WelcomeFooter({ year = 2026, className }: WelcomeFooterProps) {
  return (
    <footer
      className={['wfoot', 'welcome-wrap', className ?? ''].filter(Boolean).join(' ')}
      aria-labelledby="wfoot-heading"
    >
      <div className="wfoot__cta">
        <div className="wfoot__cta-copy">
          <h2 className="wfoot__cta-title" id="wfoot-heading">
            Tag telefonen, selv når du ikke kan
          </h2>
          <p className="wfoot__cta-sub">
            Kom i gang på under en arbejdsdag. Vi ringer dig op og sætter receptionen
            op sammen med dig.
          </p>
        </div>
        <div className="wfoot__cta-actions">
          <a className="wfoot__cta-primary" href="/login">
            Book en demo
            <ArrowGlyph />
          </a>
          <a className="wfoot__cta-ghost" href="/agency">
            Se konsollen
          </a>
        </div>
      </div>

      <div className="wfoot__cols">
        {FOOTER_COLUMNS.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <h3 className="wfoot__col-title">{column.title}</h3>
            <ul className="wfoot__list">
              {column.links.map((link) => (
                <li key={`${column.title}-${link.label}`}>
                  <a className="wfoot__link" href={link.href}>
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="wfoot__base">
        <span>© {year} Nordic Omni ApS · København</span>
        <span className="wfoot__status">
          <span className="wfoot__status-dot" aria-hidden="true" />
          <span>Operationel</span>
        </span>
      </div>
    </footer>
  );
}

function ArrowGlyph(): ReactNode {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M3.4 10.6 10.6 3.4M5.2 3.4h5.4v5.4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
