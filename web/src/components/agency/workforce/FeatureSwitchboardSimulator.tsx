'use client';

import { useMemo, useState } from 'react';
import { SegmentedControl } from '@/components/ui/glass';
import {
  DEFAULT_FEATURE_MODES,
  FEATURE_MODES,
  PORTAL_FEATURES,
  type FeatureMode,
} from '@/lib/workforce/roster';

/**
 * The 3-way feature switchboard.
 *
 * Each feature is `active`, `teaser` or `hidden`, and the preview pane on the
 * right renders exactly what a client would see for the current combination —
 * so the consequence of a switch is visible without a second screen.
 *
 * The three states are distinguishable without colour or motion:
 *   active → solid card, normal ink
 *   teaser → dashed border, labelled "Opgrader"
 *   hidden → absent entirely, and the preview says so when nothing is visible
 */

export interface FeatureSwitchboardSimulatorProps {
  className?: string;
}

export function FeatureSwitchboardSimulator({ className }: FeatureSwitchboardSimulatorProps) {
  const [modes, setModes] = useState<Record<string, FeatureMode>>(() => ({
    ...DEFAULT_FEATURE_MODES,
  }));

  const visible = useMemo(
    () => PORTAL_FEATURES.filter((feature) => (modes[feature.id] ?? 'hidden') !== 'hidden'),
    [modes],
  );

  const activeCount = PORTAL_FEATURES.filter((f) => (modes[f.id] ?? 'hidden') === 'active').length;

  return (
    <div className={['swb', className ?? ''].filter(Boolean).join(' ')}>
      <div className="swb__rows" role="group" aria-label="Klientfunktioner">
        {PORTAL_FEATURES.map((feature) => (
          <div className="swb__row" key={feature.id}>
            <span className="swb__row-id">
              <span className="swb__row-label">{feature.label}</span>
              <span className="swb__row-hint">{feature.hint}</span>
            </span>
            <span className="swb__row-seg">
              <SegmentedControl
                options={FEATURE_MODES}
                value={modes[feature.id] ?? 'hidden'}
                onChange={(next) =>
                  setModes((current) => ({ ...current, [feature.id]: next }))
                }
                label={`${feature.label} — synlighed`}
              />
            </span>
          </div>
        ))}
      </div>

      <div className="swb__preview">
        <div className="swb__preview-bar">
          <span>Klientportal · forhåndsvisning</span>
          <span style={{ marginLeft: 'auto' }}>
            {activeCount} aktiv · {visible.length - activeCount} teaser
          </span>
        </div>

        <div className="swb__preview-body">
          {visible.length === 0 ? (
            <p className="swb__empty">
              Alle funktioner er skjult. Klienten ser en tom portal — overvej mindst én
              aktiv eller teaser.
            </p>
          ) : (
            visible.map((feature) => {
              const mode = modes[feature.id] ?? 'hidden';
              return (
                <div className="swb__item" key={feature.id} data-mode={mode}>
                  <span className="swb__item-label">{feature.label}</span>
                  {mode === 'teaser' ? (
                    <span className="swb__item-note">{feature.teaserNote}</span>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
