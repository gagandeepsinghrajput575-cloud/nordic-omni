'use client';

import React, { useState } from 'react';
import { WorkforceHeader } from './WorkforceHeader';
import { EmployeePodCard } from './EmployeePodCard';
import { FeatureSwitchboardSimulator } from './FeatureSwitchboardSimulator';
import { MissionActivityFeed, type MissionLog } from './MissionActivityFeed';
import { AI_EMPLOYEES } from './workforce-types';

export function WorkforceStudio() {
  const [simulationMode, setSimulationMode] = useState(false);
  const [activeMissionsCount, setActiveMissionsCount] = useState(1);
  const [logs, setLogs] = useState<MissionLog[]>([
    {
      id: 'log-1',
      timestamp: '21:18:14',
      role: 'voice_receptionist',
      roleName: 'Søren Lindqvist',
      action: 'Inbound emergency call handled for København VVS: Triaged pipe burst in 138ms; Cal.com appointment booked.',
      status: 'SYNCED',
      durationMs: 138,
    },
  ]);

  const handleToggleSimulation = () => {
    setSimulationMode((prev) => !prev);
  };

  const handleDispatchMission = () => {
    setActiveMissionsCount((prev) => prev + 1);
    const newLog: MissionLog = {
      id: `log-${Date.now()}`,
      timestamp: new Date().toTimeString().substring(0, 8),
      role: 'general_partner',
      roleName: 'Operations Controller',
      action: 'Autonomous operational cycle dispatched: Balanced Danish ad pacing with technician on-call schedule.',
      status: 'DISPATCHED',
      durationMs: 210,
    };
    setLogs((prev) => [newLog, ...prev]);
  };

  const handleExecuteSampleTask = (role: string, task: string) => {
    const emp = AI_EMPLOYEES.find((e) => e.role === role);
    const newLog: MissionLog = {
      id: `log-${Date.now()}`,
      timestamp: new Date().toTimeString().substring(0, 8),
      role,
      roleName: emp?.name || role,
      action: `Executed verified action: "${task}"`,
      status: 'VERIFIED',
      durationMs: Math.floor(Math.random() * 300) + 200,
    };
    setLogs((prev) => [newLog, ...prev]);
  };

  return (
    <div className="space-y-8">
      {/* 1. Master Workforce Header & Quiet KPI Strip */}
      <WorkforceHeader
        activeMissionsCount={activeMissionsCount}
        simulationMode={simulationMode}
        onToggleSimulation={handleToggleSimulation}
        onDispatchMission={handleDispatchMission}
      />

      {/* 2. Department Specialists Grid */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-[17px] font-semibold tracking-tight text-[var(--text)]">
              Department Specialist
            </h2>
            <p className="text-[13px] text-[var(--muted)]">
              Dedicated autonomous agent operating verified workflows across telephony and calendar dispatch.
            </p>
          </div>
          <span className="rounded border border-[var(--line)] bg-[var(--surface-raised)] px-2.5 py-1 text-[11px] text-[var(--muted)] font-mono">
            1 Specialist
          </span>
        </div>

        <div className="grid grid-cols-1 gap-5 max-w-2xl">
          {AI_EMPLOYEES.map((employee) => (
            <EmployeePodCard
              key={employee.role}
              employee={employee}
              onExecuteSampleTask={handleExecuteSampleTask}
            />
          ))}
        </div>
      </div>

      {/* 3. Client Feature Switchboard */}
      <FeatureSwitchboardSimulator />

      {/* 4. Operational Telemetry Log */}
      <MissionActivityFeed logs={logs} />
    </div>
  );
}
