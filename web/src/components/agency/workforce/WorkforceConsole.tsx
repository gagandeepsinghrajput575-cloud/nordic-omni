'use client';

import { useState } from 'react';
import { SectionTitle } from '@/components/ui/feedback';
import { WorkforceHeader } from './WorkforceHeader';
import { EmployeePodCard } from './EmployeePodCard';
import { FeatureSwitchboardSimulator } from './FeatureSwitchboardSimulator';
import { MissionActivityFeed } from './MissionActivityFeed';
import {
  FEED_ENTRIES,
  ORCHESTRATOR_METRICS,
  PODS,
} from '@/lib/workforce/roster';

/**
 * Client shell for the workforce console.
 *
 * Holds the one piece of interactive state the page needs — whether the
 * simulation toggle is on — and composes the four surfaces. The roster itself
 * is imported data, not state, so reloading the page cannot desynchronise it
 * from the sample the tests assert.
 */
export function WorkforceConsole() {
  const [simulating, setSimulating] = useState(true);
  const activePods = PODS.filter((pod) => pod.status === 'active').length;

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
        <SectionTitle>
          Specialister
        </SectionTitle>
        <div className="pods-grid">
          {PODS.map((pod, index) => (
            <EmployeePodCard key={pod.id} pod={pod} defaultOpen={index === 0} />
          ))}
        </div>
      </section>

      <section aria-label="Klientfunktioner" className="space-y-4">
        <SectionTitle>
          Klientfunktioner
        </SectionTitle>
        <FeatureSwitchboardSimulator />
      </section>

      <section aria-label="Mission-aktiviteter" className="space-y-4">
        <SectionTitle>
          Mission-aktiviteter
        </SectionTitle>
        <MissionActivityFeed entries={FEED_ENTRIES} />
      </section>
    </div>
  );
}
