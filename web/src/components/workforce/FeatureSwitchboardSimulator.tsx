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
 * **One component, two views.** The card view lists a row per feature with the
 * client portal beside it; the matrix view renders the whole configuration as a
 * table with one column per mode. They are not two implementations sharing a
 * stylesheet — they share *one* `modes` state object and *one* preview pane, so
 * toggling a feature in either view is immediately reflected in both, and in
 * the portal simulator underneath.
 *
 * This replaced two components that had drifted into doing the same job with
 * different markup (`FeatureSwitchboardSimulator` and `SwitchboardMatrix`).
 *
 * The three states are distinguishable without colour or motion:
 *   active → solid card, normal ink
 *   teaser → dashed border, labelled "Opgrader"
 *   hidden → absent from the portal, and the preview says so when none remain
 */

export type ModeByFeature = Record<string, FeatureMode>;
export type SwitchboardView = 'card' | 'matrix';

export const SWITCHBOARD_VIEWS: ReadonlyArray<{ value: SwitchboardView; label: string }> = [
  { value: 'card', label: 'Kortvisning' },
  { value: 'matrix', label: 'Matrixvisning' },
];

const CLIENT_SEES: Record<FeatureMode, string> = {
  active: 'Ser funktionen',
  teaser: 'Ser teaser',
  hidden: 'Ser intet',
};

export interface FeatureSwitchboardSimulatorProps {
  /** Start from a specific configuration; defaults to the roster's defaults. */
  initialModes?: ModeByFeature;
  /** Which view opens first. */
  initialView?: SwitchboardView;
  className?: string;
}

export function FeatureSwitchboardSimulator({
  initialModes,
  initialView = 'card',
  className,
}: FeatureSwitchboardSimulatorProps) {
  const [view, setView] = useState<SwitchboardView>(initialView);
  const [modes, setModes] = useState<ModeByFeature>(() => ({
    ...(initialModes ?? DEFAULT_FEATURE_MODES),
  }));

  const setMode = (id: string, next: FeatureMode) =>
    setModes((current) => ({ ...current, [id]: next }));

  const counts = useMemo(() => {
    const tally: Record<FeatureMode, number> = { active: 0, teaser: 0, hidden: 0 };
    for (const feature of PORTAL_FEATURES) {
      tally[modes[feature.id] ?? 'hidden'] += 1;
    }
    return tally;
  }, [modes]);

  const visible = useMemo(
    () => PORTAL_FEATURES.filter((feature) => (modes[feature.id] ?? 'hidden') !== 'hidden'),
    [modes],
  );

  return (
    <div className={['swb', className ?? ''].filter(Boolean).join(' ')}>
      <div className="swb__toolbar">
        <SegmentedControl
          options={SWITCHBOARD_VIEWS}
          value={view}
          onChange={setView}
          label="Vælg visning"
        />
        <span className="swb__toolbar-count">
          {counts.active} aktiv · {counts.teaser} teaser · {counts.hidden} skjult
        </span>
      </div>

      <div className="swb__layout">
        {view === 'card' ? (
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
                    onChange={(next) => setMode(feature.id, next)}
                    label={`${feature.label} — synlighed`}
                  />
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="swb__scroll">
            {/* A real table: it is tabular data, and a grid of divs would lose
                the row/column association for a screen reader. */}
            <table className="swm__grid">
              <caption className="sr-only">
                Klientfunktioner og deres synlighed i klientportalen
              </caption>
              <thead>
                <tr>
                  <th scope="col">Funktion</th>
                  <th scope="col">Synlighed</th>
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
                          onChange={(next) => setMode(feature.id, next)}
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
        )}

        {/* One preview for both views, so the two cannot disagree. */}
        <div className="swb__preview">
          <div className="swb__preview-bar">
            <span>Klientportal · forhåndsvisning</span>
            <span style={{ marginLeft: 'auto' }}>
              {counts.active} aktiv · {counts.teaser} teaser
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
    </div>
  );
}
