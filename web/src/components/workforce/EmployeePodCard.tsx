'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ArrowRight, Check, SlidersHorizontal } from 'lucide-react';
import { buttonClass } from '@/components/ui/form';
import type { AIEmployee } from './workforce-types';

interface EmployeePodCardProps {
  employee: AIEmployee;
  onExecuteSampleTask: (role: string, task: string) => void;
}

export function EmployeePodCard({
  employee,
  onExecuteSampleTask,
}: EmployeePodCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [running, setRunning] = useState(false);
  const [taskOutput, setTaskOutput] = useState<string | null>(null);

  const handleRunTask = () => {
    setRunning(true);
    setTaskOutput(null);

    setTimeout(() => {
      setRunning(false);
      if (employee.role === 'voice_receptionist') {
        setTaskOutput(
          `✓ Telephony Triage Verified (Latency: 138ms):\n` +
          `• Inbound call: "+45 20 12 34 56" (København VVS)\n` +
          `• Intent: Akut vandrør brud på Østerbro (Urgency: High)\n` +
          `• Calendar: Cal.com booked technician for 08:30 CET tomorrow\n` +
          `• Grounding: Danish emergency callout tariff confirmed at 2.200 DKK`
        );
      }
      onExecuteSampleTask(employee.role, employee.sampleTask);
    }, 900);
  };

  const getActionLabel = () => {
    switch (employee.role) {
      case 'voice_receptionist':
        return 'Test Inbound Call';
      default:
        return 'Run Action';
    }
  };

  return (
    <div className="flex flex-col justify-between rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 transition-all duration-200 hover:border-[var(--border-control)]">
      <div>
        {/* Card Header: Initials Badge, Name, Department & Status */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--panel-2)] text-[12px] font-medium tracking-tight text-[var(--text)]">
              {employee.initials}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[14px] font-semibold text-[var(--text)]">
                  {employee.name}
                </h3>
                <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
                  <span className="dot-live" aria-hidden />
                  <span>{employee.status}</span>
                </span>
              </div>
              <p className="text-[12px] text-[var(--muted)]">{employee.title}</p>
            </div>
          </div>

          <span className="rounded border border-[var(--line)] bg-[var(--surface-raised)] px-2 py-0.5 text-[11px] text-[var(--muted)] font-normal">
            {employee.department}
          </span>
        </div>

        {/* Operational Description */}
        <p className="mt-3.5 text-[13px] leading-relaxed text-[var(--text-secondary)]">
          {employee.description}
        </p>

        {/* 3-Column Metrics Strip with quiet hairline rules */}
        <div className="mt-4 grid grid-cols-3 gap-2 border-y border-[var(--line)] py-3">
          {employee.metrics.map((metric, idx) => (
            <div key={idx} className="flex flex-col">
              <span className="text-[11px] text-[var(--muted)] font-normal">
                {metric.label}
              </span>
              <span className="mt-0.5 text-[14px] font-semibold font-mono text-[var(--text)] tabular-nums">
                {metric.value}
              </span>
              <span className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                {metric.change}
              </span>
            </div>
          ))}
        </div>

        {/* Operational Scope Tags */}
        <div className="mt-3.5 flex flex-wrap gap-1.5">
          {employee.tags.map((tag) => (
            <span
              key={tag}
              className="rounded border border-[var(--line)] bg-[var(--panel-2)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* Card Footer: Capabilities & Action Trigger */}
      <div className="mt-5 border-t border-[var(--line)] pt-3.5">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="inline-flex items-center gap-1.5 text-[12px] text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          >
            <SlidersHorizontal size={13} aria-hidden />
            <span>{expanded ? 'Hide capabilities' : 'Capabilities'}</span>
            <ChevronDown
              size={13}
              className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            />
          </button>

          <button
            type="button"
            disabled={running}
            onClick={handleRunTask}
            className={buttonClass('secondary', 'sm', 'h-8 px-3 text-[12px] gap-1.5')}
          >
            <span>{running ? 'Executing…' : getActionLabel()}</span>
            <ArrowRight size={13} aria-hidden />
          </button>
        </div>

        {/* Expanded Capabilities Drawer */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <div className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--panel-2)] p-3 text-[12px]">
                <span className="font-medium text-[var(--text)] block mb-1.5">
                  Autonomous capabilities:
                </span>
                <ul className="space-y-1.5 text-[var(--text-secondary)]">
                  {employee.capabilities.map((cap, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[var(--accent-primary)] shrink-0" />
                      <span>{cap}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Task Output Terminal Simulation */}
        <AnimatePresence>
          {taskOutput && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <div className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--panel-2)] p-3 font-mono text-[11px] text-[var(--text)]">
                <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-[var(--line)] text-[10px] text-[var(--muted)]">
                  <span>Operational Output</span>
                  <span className="text-[var(--text)] font-semibold">200 OK</span>
                </div>
                <pre className="whitespace-pre-wrap leading-relaxed">{taskOutput}</pre>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
