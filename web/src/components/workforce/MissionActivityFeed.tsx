'use client';

import type { FeedEntry } from '@/lib/workforce/roster';

/**
 * The mission activity log.
 *
 * A monospace read-out of autonomous task executions and verified commits.
 *
 * It is **not** a live tail. Timestamps come from the entries themselves, the
 * component starts no interval, and the footer says the log is a sample. The
 * alternative — a `setInterval` appending fabricated lines — would be a UI
 * pretending to have data it does not have, and would also break hydration.
 *
 * Verified entries render brighter rather than tinted: the emphasis is
 * brightness, so the log introduces no colour.
 */

export interface MissionActivityFeedProps {
  entries: ReadonlyArray<FeedEntry>;
  className?: string;
}

export function MissionActivityFeed({ entries, className }: MissionActivityFeedProps) {
  return (
    <div className={['feed', className ?? ''].filter(Boolean).join(' ')}>
      <div className="feed__bar">
        <span>mission.log</span>
        <span style={{ marginLeft: 'auto' }}>{entries.length} linjer · sample</span>
      </div>

      <div className="feed__body" role="log" aria-label="Agentaktiviteter" tabIndex={0}>
        {entries.map((entry) => (
          <div
            className="feed__line"
            key={`${entry.time}-${entry.kind}-${entry.message}`}
            data-verified={entry.verified ? 'true' : 'false'}
          >
            <span className="feed__time">{entry.time}</span>
            <span className="feed__kind">{entry.kind}</span>
            <span className="feed__msg">{entry.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
