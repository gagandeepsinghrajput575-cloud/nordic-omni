'use client';

import { useState } from 'react';
import { buttonClass } from '@/components/ui/form';
import { HeroHeadline } from './HeroHeadline';
import { StudioPlaygroundCard, type StudioMode, type StudioTile } from './StudioPlaygroundCard';
import type { TabOption } from './GlidingTabSwitcher';

/**
 * Piece 1: hero band + interactive studio canvas.
 *
 * Scope is deliberately headline + canvas. There is no marketing nav and no
 * announcement bar, so this route never has to reason about auth state to
 * decide whether to show "Log in" or "Dashboard".
 *
 * Copy stays Danish, matching the voice-receptionist product; the composition
 * is the reference's, the language is ours.
 */

export const STUDIO_MODES: ReadonlyArray<TabOption<StudioMode>> = [
  { value: 'speech', label: 'Speech' },
  { value: 'agent', label: 'Conversational Agent' },
  { value: 'studio', label: 'Voice Studio' },
];

/**
 * Tiles per mode.
 *
 * `ramp` is a size/weight stop, not a colour: every orb derives from
 * `--el-elevated` and `--text`, so the set stays achromatic and the stylesheet
 * scan in `design-system.test.ts` has nothing to object to.
 */
export const STUDIO_TILES: Record<StudioMode, readonly StudioTile[]> = {
  speech: [
    { id: 'characters', title: 'Stemmer', caption: 'Legende og engagerende', ramp: 0 },
    { id: 'narration', title: 'Fortælling', caption: 'Udtryksfulde stemmer til historier', ramp: 2, featured: true },
    { id: 'natural', title: 'Naturlig tale', caption: 'Flydende dansk, uden robotlyd', ramp: 1 },
  ],
  agent: [
    { id: 'reception', title: 'Reception', caption: 'Tager telefonen, dag og nat', ramp: 2, featured: true },
    { id: 'booking', title: 'Booking', caption: 'Finder ledige tider i kalenderen', ramp: 1 },
    { id: 'handoff', title: 'Viderestilling', caption: 'Giver videre med fuld kontekst', ramp: 0 },
  ],
  studio: [
    { id: 'voice', title: 'Stemmebibliotek', caption: 'Vælg og finjuster en stemme', ramp: 1 },
    { id: 'clone', title: 'Klon', caption: 'Din egen stemme, samme tone', ramp: 2, featured: true },
    { id: 'mix', title: 'Lyddesign', caption: 'Pause, tempo og betoning', ramp: 0 },
  ],
};

export interface HeroSectionProps {
  /** Override the display lines, e.g. for an A/B headline. */
  lines?: readonly string[];
  className?: string;
}

export function HeroSection({ lines, className }: HeroSectionProps) {
  const [mode, setMode] = useState<StudioMode>('speech');

  return (
    <div className={['welcome-wrap', 'welcome-body', className ?? ''].filter(Boolean).join(' ')}>
      <HeroHeadline
        lines={lines ?? ['Bringing', 'technology to life']}
        deck={
          <>
            Vi bygger den danske telefonreception, der aldrig sover. Fra kundesamtaler og
            booking til lead-håndtering og opkald — drevet af stemme, der lyder som et menneske.
          </>
        }
      />

      <div className="welcome-actions">
        <a className={buttonClass('primary', 'md')} href="/login">
          Kom i gang
        </a>
        <a className={buttonClass('secondary', 'md')} href="/showcase">
          Se demonstration
        </a>
      </div>

      <StudioPlaygroundCard
        modes={STUDIO_MODES}
        mode={mode}
        onModeChange={setMode}
        tiles={STUDIO_TILES[mode]}
      />
    </div>
  );
}
