'use client';

import { useMemo, useState } from 'react';
import { SegmentedControl } from '@/components/ui/glass';
import {
  FEATURE_MODES,
  PORTAL_FEATURES,
  type FeatureMode,
} from '@/lib/workforce/roster';

/**
 * The switchboard as a matrix.
 *
 * Where `FeatureSwitchboardSimulator` lists a row per feature with the client
 * preview beside it, this renders the same state as a table: one row per
 * feature, one column per mode, and a live "client sees" column. The point is
 * to see the whole configuration at once rather than one row at a time.
 *
 * Rendered as a real `<table>` with `<th scope>` on both axes, because it is
 * tabular data — a grid of divs would lose the row/column association for
 * anyone using a screen reader.
 *
 * The three states are distinguishable without colour: active is solid,
 * teaser is dashed and labelled, hidden is absent from the portal and reads
 * muted in the matrix.
 */

export type ModeByFeature = Record<string, FeatureMode>;

const CLIENT_SEES: Record<FeatureMode, string> = {
  active: 'Ser funktionen',
  teaser: 'Ser teaser',
  hidden: 'Ser intet',
};

export interface SwitchboardMatrixProps {
  /** Controlled initial state; defaults to the roster's defaults. */
  initialModes?: ModeByFeature;
  className?: string;
}

export function SwitchboardMatrix({ initialModes, className }: SwitchboardMatrixProps) {
  const [modes, setModes] = useState<ModeByFeature>(
    () =>
      initialModes ?? {
        inbound: 'active',
        leads: 'active',
        reports: 'teaser',
        webhooks: 'hidden',
      },
  );

  const counts = useMemo(() => {
    const tally: Record<FeatureMode, number> = { active: 0, teaser: 0, hidden: 0 };
    for (const feature of PORTAL_FEATURES) {
      tally[modes[feature.id] ?? 'hidden'] += 1;
    }
    return tally;
  }, [modes]);

  const visibleCount = counts.active + counts.teaser;

  return (
    <div className={['swm', className ?? ''].filter(Boolean).join(' ')}>
      <div className="swm__scroll">
        <table className="swm__grid">
          <caption className="sr-only">
            Klientfunktioner og deres synlighed i klientportalen
          </caption>
          <thead>
            <tr>
              <th scope="col">Funktion</th>
              {FEATURE_MODES.map((mode) => (
                <th scope="col" key={mode.value}>
                  {mode.label}
                </th>
              ))}
              <th scope="col">Klienten ser</th>
            </tr>
          </thead>
          <tbody>
            {PORTAL_FEATURES.map((feature) => {
              const mode = modes[feature.id] ?? 'hidden';
              return (
                <tr key={feature.id}>
                  <th scope="row" className="swm__feature">
                    {feature.label}
                    <span className="swm__hint">{feature.hint}</span>
                  </th>
                  <td className="swm__cell">
                    <SegmentedControl
                      options={FEATURE_MODES}
                      value={mode}
                      onChange={(next) =>
                        setModes((current) => ({ ...current, [feature.id]: next }))
                      }
                      label={`${feature.label} — synlighed`}
                    />
                  </td>
                  <td className="swm__cell">
                    <span className="swm__preview" data-mode={mode}>
                      {CLIENT_SEES[mode]}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="swm__foot">
        <span className="wf-live">
          <span className="wf-dot" data-state={visibleCount > 0 ? 'live' : 'idle'} aria-hidden="true" />
          {visibleCount === 0 ? 'Tom portal' : `${visibleCount} synlige for klienten`}
        </span>
        <span className="swm__counter">
          {counts.active} aktiv · {counts.teaser} teaser · {counts.hidden} skjult
        </span>
      </div>

      {visibleCount === 0 ? (
        <p className="dsc__panel-sub" role="status">
          Alle funktioner er skjult. Klienten møder en tom portal — overvej mindst én
          aktiv eller teaser.
        </p>
      ) : null}
    </div>
  );
}
