'use client';

import React from 'react';
import { motion } from 'framer-motion';
import {
  TrendingUp,
  Users,
  CalendarCheck,
  PhoneCall,
  AlertOctagon,
  Sparkles,
} from 'lucide-react';
import { useUICommandStore } from '@/lib/store/ui-command-store';
import { PipelineStage } from '@/contracts/schemas';

interface ScorecardItem {
  id: string;
  title: string;
  value: string;
  change: string;
  isPositive: boolean;
  filterStage?: PipelineStage | 'all';
  icon: React.ComponentType<{ className?: string }>;
  accentColor: string; // Tailwind border/text color class
  sparklinePoints: string;
}

export const AnimatedScorecards: React.FC = () => {
  const {
    currentTenant,
    status,
    contacts,
    callLogs,
    focusedScorecardId,
    activePipelineFilter,
    setPipelineFilter,
    focusScorecard,
  } = useUICommandStore();

  const isDanish = currentTenant?.default_language === 'da-DK';

  // Compute live aggregates from Store
  const totalPipelineDkk = contacts.reduce(
    (sum, c) => sum + (Number(c.estimated_value_dkk) || 0),
    0
  );
  const totalLeads = contacts.length;
  const bookedLeads = contacts.filter((c) => c.pipeline_stage === 'booked').length;
  const conversionRate = totalLeads > 0 ? Math.round((bookedLeads / totalLeads) * 100) : 0;
  const totalCallSeconds = callLogs.reduce((sum, cl) => sum + (cl.duration_seconds || 0), 0);
  const totalCallMinutes = Math.round(totalCallSeconds / 60);
  const direCount = contacts.filter((c) => c.pipeline_stage === 'dire_escalated').length;

  const scorecards: ScorecardItem[] = [
    {
      id: 'pipeline-value',
      title: isDanish ? 'Samlet Pipeline Værdi' : 'Total Pipeline Value',
      value: `${totalPipelineDkk.toLocaleString(isDanish ? 'da-DK' : 'en-US')} DKK`,
      change: isDanish ? '+24.5% vs. sidste uge' : '+24.5% vs last week',
      isPositive: true,
      filterStage: 'all',
      icon: TrendingUp,
      accentColor: 'border-cyan-500/50 text-cyan-400 bg-cyan-950/20',
      sparklinePoints: '0,20 10,18 20,24 30,14 40,16 50,8 60,12 70,4 80,8',
    },
    {
      id: 'inbound-leads',
      title: isDanish ? 'Aktive Leads (Meta + Form)' : 'Active Leads (Meta + Form)',
      value: totalLeads.toString(),
      change: isDanish ? '1-tap opkaldslinks aktive' : '1-tap call links active',
      isPositive: true,
      filterStage: 'new_lead',
      icon: Users,
      accentColor: 'border-purple-500/50 text-purple-400 bg-purple-950/20',
      sparklinePoints: '0,18 10,16 20,12 30,15 40,10 50,8 60,6 70,4 80,2',
    },
    {
      id: 'booked-conversions',
      title: isDanish ? 'Autonomt Booket af AI' : 'AI Booked Appointments',
      value: `${conversionRate}% (${bookedLeads} ${isDanish ? 'stk' : 'deals'})`,
      change: isDanish ? 'Ingen manuelle tastefejl' : 'Zero manual entry needed',
      isPositive: true,
      filterStage: 'booked',
      icon: CalendarCheck,
      accentColor: 'border-emerald-500/50 text-emerald-400 bg-emerald-950/20',
      sparklinePoints: '0,22 10,20 20,18 30,14 40,12 50,10 60,8 70,6 80,4',
    },
    {
      id: 'webrtc-minutes',
      title: isDanish ? 'AI Taletid ($0 WebRTC / SIP)' : 'AI Call Time ($0 WebRTC / SIP)',
      value: `${totalCallMinutes} min`,
      change: isDanish ? '$0.00 udgående bærergebyr' : '$0.00 carrier fee ($0 WebRTC)',
      isPositive: true,
      icon: PhoneCall,
      accentColor: 'border-sky-500/50 text-sky-400 bg-sky-950/20',
      sparklinePoints: '0,14 10,16 20,12 30,10 40,14 50,8 60,10 70,6 80,4',
    },
    {
      id: 'dire-alerts',
      title: isDanish ? 'Akutte Nødsager (Dire)' : 'Dire Emergency Escalations',
      value: `${direCount} ${isDanish ? 'aktive' : 'active'}`,
      change:
        direCount > 0
          ? isDanish
            ? 'Kræver øjeblikkelig ejer-handling'
            : 'Requires immediate owner action'
          : isDanish
          ? 'Alt under kontrol'
          : 'All systems operational',
      isPositive: direCount === 0,
      filterStage: 'dire_escalated',
      icon: AlertOctagon,
      accentColor: direCount > 0 ? 'border-red-500/80 text-red-400 bg-red-950/30' : 'border-gray-700 text-gray-400 bg-gray-900/40',
      sparklinePoints: '0,8 10,12 20,8 30,6 40,16 50,22 60,14 70,8 80,6',
    },
  ];

  // 1. SKELETON STATE
  if (status === 'skeleton') {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="p-4 rounded-2xl bg-gray-900/60 border border-gray-800 animate-pulse space-y-3"
          >
            <div className="h-4 w-28 bg-gray-800 rounded" />
            <div className="h-7 w-20 bg-gray-700 rounded" />
            <div className="h-3 w-36 bg-gray-800 rounded" />
          </div>
        ))}
      </div>
    );
  }

  // 2. ERROR STATE
  if (status === 'error') {
    return (
      <div className="p-4 rounded-2xl bg-red-950/30 border border-red-800/60 text-red-300 text-sm flex items-center gap-3">
        <AlertOctagon className="w-5 h-5 text-red-400" />
        <span>
          {isDanish
            ? 'Fejl ved indlæsning af KPI metrikker. LiveKit og Supabase synkronisering afbrudt.'
            : 'Error loading KPI metrics. LiveKit and Supabase real-time synchronization interrupted.'}
        </span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
      {scorecards.map((card) => {
        const Icon = card.icon;
        const isFocused = focusedScorecardId === card.id;
        const isFilterActive = card.filterStage && activePipelineFilter === card.filterStage;

        return (
          <motion.div
            key={card.id}
            whileHover={{ y: -3, transition: { duration: 0.15 } }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              focusScorecard(isFocused ? null : card.id);
              if (card.filterStage) {
                setPipelineFilter(isFilterActive ? 'all' : card.filterStage);
              }
            }}
            tabIndex={0}
            role="button"
            aria-pressed={isFilterActive}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                focusScorecard(isFocused ? null : card.id);
                if (card.filterStage) {
                  setPipelineFilter(isFilterActive ? 'all' : card.filterStage);
                }
              }
            }}
            className={`relative p-4 rounded-2xl border transition-all cursor-pointer backdrop-blur-md overflow-hidden ${
              card.accentColor
            } ${
              isFocused
                ? 'ring-2 ring-cyan-400 shadow-lg shadow-cyan-500/20 scale-[1.02]'
                : isFilterActive
                ? 'ring-1 ring-purple-400'
                : 'hover:border-gray-600'
            }`}
          >
            {/* Header & Icon */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-400 truncate tracking-wide">
                {card.title}
              </span>
              <div className="p-1.5 rounded-lg bg-gray-900/60 border border-gray-800 text-gray-300">
                <Icon className="w-4 h-4" />
              </div>
            </div>

            {/* Metric Value */}
            <div className="mt-2 text-2xl font-black tracking-tight text-white font-mono">
              {card.value}
            </div>

            {/* Subtitle & Sparkline */}
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[11px] font-medium text-gray-400 flex items-center gap-1">
                {card.isPositive ? (
                  <Sparkles className="w-3 h-3 text-cyan-400" />
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-ping" />
                )}
                {card.change}
              </span>

              {/* Mini SVG Sparkline */}
              <svg className="w-14 h-5 overflow-visible" viewBox="0 0 80 25">
                <polyline
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={card.sparklinePoints}
                  className="opacity-70"
                />
              </svg>
            </div>

            {/* Glowing Focus Indicator */}
            {isFocused && (
              <motion.div
                layoutId="focusedCardBorder"
                className="absolute inset-0 rounded-2xl border-2 border-cyan-400 pointer-events-none"
              />
            )}
          </motion.div>
        );
      })}
    </div>
  );
};
