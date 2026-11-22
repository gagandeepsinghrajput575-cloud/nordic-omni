'use client';

import React from 'react';

export interface MissionLog {
  id: string;
  timestamp: string;
  role: string;
  roleName: string;
  action: string;
  status: 'VERIFIED' | 'DISPATCHED' | 'OPTIMIZED' | 'SYNCED';
  durationMs: number;
}

const DEFAULT_LOGS: MissionLog[] = [
  {
    id: 'log-1',
    timestamp: '21:18:14',
    role: 'voice_receptionist',
    roleName: 'Søren Lindqvist',
    action: 'Inbound emergency call handled for København VVS: Triaged pipe burst in 138ms; Cal.com appointment booked.',
    status: 'SYNCED',
    durationMs: 138,
  },
  {
    id: 'log-2',
    timestamp: '20:58:02',
    role: 'general_partner',
    roleName: 'Operations Controller',
    action: 'Security & invariant verification: Zero TypeScript warnings, strict tenant isolation (RLS) confirmed.',
    status: 'VERIFIED',
    durationMs: 190,
  },
];

interface MissionActivityFeedProps {
  logs?: MissionLog[];
}

export function MissionActivityFeed({ logs = DEFAULT_LOGS }: MissionActivityFeedProps) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-6">
      <div className="flex items-center justify-between pb-4 border-b border-[var(--line)]">
        <div>
          <span className="text-[11px] font-medium text-[var(--muted)] tracking-wider uppercase">
            Telemetry & Invariants
          </span>
          <h2 className="text-[16px] font-semibold tracking-tight text-[var(--text)] mt-0.5">
            Operational Activity Log
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="dot-live" aria-hidden />
          <span className="text-[11px] font-mono text-[var(--muted)]">Stream Active</span>
        </div>
      </div>

      <div className="mt-4 divide-y divide-[var(--line)]">
        {logs.map((log) => (
          <div
            key={log.id}
            className="flex flex-col gap-2 py-3 transition-colors first:pt-1 last:pb-1 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-start gap-3 min-w-0">
              <span className="text-[11px] font-mono text-[var(--muted)] pt-0.5 shrink-0 tabular-nums">
                [{log.timestamp}]
              </span>
              <div className="min-w-0">
                <span className="inline-block rounded border border-[var(--line)] bg-[var(--surface-raised)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text)] mr-2 shrink-0">
                  {log.roleName}
                </span>
                <span className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
                  {log.action}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0 self-end sm:self-center pl-4">
              <span className="text-[11px] font-mono text-[var(--muted)] tabular-nums">
                {log.durationMs}ms
              </span>
              <span className="rounded border border-[var(--line)] bg-[var(--panel-2)] px-2 py-0.5 text-[10px] font-mono font-medium text-[var(--text)]">
                {log.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
