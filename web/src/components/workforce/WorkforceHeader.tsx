'use client';

import React from 'react';
import { ArrowRight, Play, RefreshCw, Shield, Sparkles } from 'lucide-react';
import { buttonClass } from '@/components/ui/form';

interface WorkforceHeaderProps {
  activeMissionsCount: number;
  simulationMode: boolean;
  onToggleSimulation: () => void;
  onDispatchMission: () => void;
}

export function WorkforceHeader({
  activeMissionsCount,
  simulationMode,
  onToggleSimulation,
  onDispatchMission,
}: WorkforceHeaderProps) {
  return (
    <div className="space-y-6">
      {/* Top Editorial Eyebrow & Hero Title */}
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center rounded-full border border-[var(--accent-line)] bg-[var(--accent-soft)] px-3 py-1 text-[11px] font-medium tracking-[0.02em] text-[var(--accent-primary)]">
              AI Workforce & Operations
            </span>
            <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--muted)]">
              <span className="dot-live" aria-hidden />
              <span>Autonomous Active</span>
            </span>
          </div>

          <h1 className="mt-3 text-[clamp(26px,2.8vw,36px)] font-semibold leading-[1.1] tracking-[-0.045em] text-[var(--text)]">
            Autonomous Specialists
          </h1>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-[var(--text-secondary)]">
            Dedicated autonomous voice receptionists calibrated for Danish trade businesses and clinics. Grounded in real customer conversations.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onToggleSimulation}
            className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-[12px] font-medium transition-colors ${
              simulationMode
                ? 'border-[var(--line)] bg-[var(--surface-raised)] text-[var(--text)]'
                : 'border-[var(--line)] bg-transparent text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                simulationMode ? 'bg-[var(--accent-primary)]' : 'bg-[var(--muted)]'
              }`}
            />
            <span>{simulationMode ? 'Simulation: Preview' : 'Live Environment'}</span>
          </button>

          <button
            type="button"
            onClick={onDispatchMission}
            className={buttonClass('primary', 'sm', 'h-9 px-4 gap-2')}
          >
            <span>Dispatch Operational Cycle</span>
            <ArrowRight size={14} aria-hidden />
          </button>
        </div>
      </div>

      {/* Operational KPI Strip — Single quiet container with hairline rules */}
      <div className="stats-grid">
        <div className="stat">
          <span className="stat-label">Inbound Calls Managed</span>
          <p className="stat-val mt-1">3,842</p>
          <span className="stat-sub mt-1 block">99.8% answered under 3 rings</span>
        </div>
        <div className="stat">
          <span className="stat-label">Audio Stream Latency</span>
          <p className="stat-val mt-1">142ms</p>
          <span className="stat-sub mt-1 block">Sub-150ms barge-in target met</span>
        </div>
        <div className="stat">
          <span className="stat-label">Confirmed Appointments</span>
          <p className="stat-val mt-1">648</p>
          <span className="stat-sub mt-1 block">Synced directly to Cal.com</span>
        </div>
        <div className="stat">
          <span className="stat-label">Active Missions Pacing</span>
          <p className="stat-val mt-1">{activeMissionsCount}</p>
          <span className="stat-sub mt-1 block">Zero budget overspend</span>
        </div>
      </div>
    </div>
  );
}
