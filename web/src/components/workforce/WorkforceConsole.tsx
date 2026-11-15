'use client';

import { useCallback, useMemo, useState } from 'react';
import { SectionTitle } from '@/components/ui/feedback';
import { WorkforceHeader } from './WorkforceHeader';
import { EmployeePodCard } from './EmployeePodCard';
import { FeatureSwitchboardSimulator } from './FeatureSwitchboardSimulator';
import { MissionActivityFeed } from './MissionActivityFeed';
import { DispatchSimulationConsole } from './DispatchSimulationConsole';
import {
  FEED_ENTRIES,
  ORCHESTRATOR_METRICS,
  PODS,
  dispatchFeedEntries,
  type FeedEntry,
} from '@/lib/workforce/roster';

/**
 * Client shell for the workforce console.
 *
 * The console owns the three pieces of shared state:
 *
 *  - `simulating`, the orchestrator's mode toggle;
 *  - `feed`, the mission log, which the dispatch console appends to when a
 *    runner completes. The dispatch console reports; this shell appends, so
 *    there is exactly one owner of the log.
 *
 * The roster itself is imported data, not state, so reloading the page cannot
 * desynchronise it from the sample the tests assert.
 */

/** Newest-first, and capped so a long session cannot grow without bound. */
const FEED_CAP = 40;

export function WorkforceConsole() {
  const [simulating, setSimulating] = useState(true);
  const [feed, setFeed] = useState<ReadonlyArray<FeedEntry>>(FEED_ENTRIES);

  const appendDispatch = useCallback((runner: Parameters<typeof dispatchFeedEntries>[0]) => {
    const at = new Date().toLocaleTimeString('da-DK', { hour12: false });
    setFeed((current) => [...dispatchFeedEntries(runner, at), ...current].slice(0, FEED_CAP));
  }, []);

  const activePods = useMemo(() => PODS.filter((pod) => pod.status === 'active').length, []);

  return (
    <div className="space-y-7">
      <WorkforceHeader
        metrics={ORCHESTRATOR_METRICS}
        activePods={activePods}
        totalPods={PODS.length}
        simulating={simulating}
        onToggleSimulation={() => setSimulating((current) => !current)}
      />

      <section aria-label="Specialister" className="space-y-4">
        <SectionTitle>Specialister</SectionTitle>
        <div className="pods-grid">
          {PODS.map((pod, index) => (
            <EmployeePodCard key={pod.id} pod={pod} defaultOpen={index === 0} />
          ))}
        </div>
      </section>

      <section aria-label="Test-dispatch" className="space-y-4">
        <SectionTitle>Test-dispatch</SectionTitle>
        <DispatchSimulationConsole onDispatched={appendDispatch} />
      </section>

      <section aria-label="Klientfunktioner" className="space-y-4">
        <SectionTitle>Klientfunktioner</SectionTitle>
        <FeatureSwitchboardSimulator />
      </section>

      <section aria-label="Mission-aktiviteter" className="space-y-4">
        <SectionTitle>
          <span className="wfhud__sub" style={{ display: 'inline' }}>
            Mission-aktiviteter
          </span>
        </SectionTitle>
        <MissionActivityFeed entries={feed} />
      </section>
    </div>
  );
}
