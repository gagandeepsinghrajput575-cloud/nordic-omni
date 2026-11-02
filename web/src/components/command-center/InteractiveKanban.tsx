'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquare,
  Instagram,
  PhoneCall,
  FileText,
  AlertTriangle,
  ChevronRight,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import { useUICommandStore } from '@/lib/store/ui-command-store';
import { Contact, PipelineStage, Channel } from '@/contracts/schemas';

interface StageColumnConfig {
  key: PipelineStage;
  titleDa: string;
  titleEn: string;
  badgeColor: string;
  borderColor: string;
}

const STAGES: StageColumnConfig[] = [
  { key: 'new_lead', titleDa: 'Nye Henvendelser', titleEn: 'New Inbound Leads', badgeColor: 'bg-cyan-950 text-cyan-300 border-cyan-800', borderColor: 'border-cyan-800/40' },
  { key: 'contacted', titleDa: 'Kontaktet (Meta/SMS)', titleEn: 'Contacted (Meta/SMS)', badgeColor: 'bg-blue-950 text-blue-300 border-blue-800', borderColor: 'border-blue-800/40' },
  { key: 'qualified', titleDa: 'Kvalificeret Sag', titleEn: 'Qualified Leads', badgeColor: 'bg-purple-950 text-purple-300 border-purple-800', borderColor: 'border-purple-800/40' },
  { key: 'booked', titleDa: 'Aftale Booket (AI)', titleEn: 'Booked Appointments (AI)', badgeColor: 'bg-emerald-950 text-emerald-300 border-emerald-800', borderColor: 'border-emerald-800/40' },
  { key: 'dire_escalated', titleDa: '🚨 AKUT / Haste', titleEn: '🚨 Dire Emergency (+45)', badgeColor: 'bg-red-950 text-red-300 border-red-800 animate-pulse', borderColor: 'border-red-800/60' },
  { key: 'closed_won', titleDa: 'Vundet & Afsluttet', titleEn: 'Closed Won & Finished', badgeColor: 'bg-teal-950 text-teal-300 border-teal-800', borderColor: 'border-teal-800/40' },
];

export const InteractiveKanban: React.FC = () => {
  const {
    currentTenant,
    contacts,
    status,
    isStale,
    activePipelineFilter,
    openContactDrawer,
    optimisticMoveDealStage,
  } = useUICommandStore();

  const isDanish = currentTenant?.default_language === 'da-DK';

  const getChannelIcon = (channel: Channel) => {
    switch (channel) {
      case 'whatsapp':
        return <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />;
      case 'instagram':
        return <Instagram className="w-3.5 h-3.5 text-pink-400" />;
      case 'voice_inbound':
      case 'voice_instant_webrtc':
        return <PhoneCall className="w-3.5 h-3.5 text-cyan-400" />;
      case 'lead_form':
      default:
        return <FileText className="w-3.5 h-3.5 text-amber-400" />;
    }
  };

  const filteredStages = activePipelineFilter === 'all'
    ? STAGES
    : STAGES.filter((s) => s.key === activePipelineFilter);

  // 1. SKELETON STATE
  if (status === 'skeleton') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="p-3 rounded-2xl bg-gray-950 border border-gray-800 space-y-3 animate-pulse">
            <div className="h-4 w-24 bg-gray-800 rounded" />
            <div className="h-28 bg-gray-900 rounded-xl" />
            <div className="h-28 bg-gray-900 rounded-xl" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="relative">
      {/* 2. STALE RECONNECTION BANNER (Fixed viewport-edge to prevent CLS) */}
      {isStale && (
        <div className="mb-4 px-4 py-2 rounded-xl bg-amber-950/80 border border-amber-500/60 text-amber-300 text-xs font-medium flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 animate-bounce" />
            <span>
              {isDanish
                ? 'Forbindelsen til Supabase Realtime er ustabil. Viser cachet pipeline.'
                : 'Connection to Supabase Realtime interrupted. Displaying cached pipeline.'}
            </span>
          </div>
          <span className="text-[10px] font-mono uppercase bg-amber-900/60 px-2 py-0.5 rounded">Reconnecting...</span>
        </div>
      )}

      {/* Kanban Multi-Column Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 items-start">
        {filteredStages.map((stage) => {
          const stageContacts = contacts.filter((c) => c.pipeline_stage === stage.key);
          const stageValue = stageContacts.reduce(
            (sum, c) => sum + (Number(c.estimated_value_dkk) || 0),
            0
          );

          return (
            <div
              key={stage.key}
              className="p-3 rounded-2xl bg-[var(--bg-surface,#0A0D15)] border border-[var(--border-subtle,#1E2638)] backdrop-blur-md flex flex-col min-h-[500px] transition-colors"
            >
              {/* Column Header */}
              <div className="flex items-center justify-between pb-3 border-b border-[var(--border-subtle,#1E2638)]">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold border ${stage.badgeColor}`}>
                    {stageContacts.length}
                  </span>
                  <h3 className="text-xs font-bold text-[var(--text-primary,#FFFFFF)] tracking-wide">
                    {isDanish ? stage.titleDa : stage.titleEn}
                  </h3>
                </div>
              </div>

              {/* Total DKK per Stage */}
              <div className="py-2 text-[11px] font-mono text-[var(--text-muted,#8E9CAE)] flex justify-between items-center">
                <span>{isDanish ? 'Værdi:' : 'Value:'}</span>
                <span className="font-semibold text-[var(--text-primary,#FFFFFF)] tabular-nums">
                  {stageValue.toLocaleString(isDanish ? 'da-DK' : 'en-US')} DKK
                </span>
              </div>

              {/* Column Cards */}
              <div className="mt-2 space-y-3 flex-1 overflow-y-auto pr-0.5">
                <AnimatePresence mode="popLayout">
                  {stageContacts.map((contact) => (
                    <motion.div
                      key={contact.id}
                      layout
                      initial={{ opacity: 0, scale: 0.95, y: 10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: -10 }}
                      transition={{ duration: 0.2 }}
                      whileHover={{ y: -2 }}
                      onClick={() => openContactDrawer(contact.id)}
                      className={`p-3.5 rounded-xl border transition-all cursor-pointer bg-[var(--bg-raised,#121824)] hover:bg-[var(--bg-surface,#182133)] ${
                        contact.pipeline_stage === 'dire_escalated'
                          ? 'border-[var(--danger,#FF2A85)] shadow-lg shadow-[var(--danger,#FF2A85)]/20 bg-[var(--danger,#FF2A85)]/10'
                          : 'border-[var(--border-subtle,#1E2638)] hover:border-[var(--border-strong,#2B374E)]'
                      }`}
                    >
                      {/* Contact Name & Channel */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-[var(--text-primary,#FFFFFF)] truncate max-w-[140px]">
                          {contact.full_name || (isDanish ? 'Ukendt Lead' : 'Unknown Lead')}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span className="p-1 rounded-md bg-[var(--bg-ground,#08090C)] border border-[var(--border-subtle,#1E2638)]">
                            {getChannelIcon(contact.preferred_channel)}
                          </span>
                        </div>
                      </div>

                      {/* Phone & Lead Score */}
                      <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--text-secondary,#8E9CAE)] font-mono">
                        <span>{contact.phone_number || (isDanish ? 'Intet tlf.' : 'No phone')}</span>
                        <span
                          className={`font-bold px-1.5 py-0.2 rounded text-[10px] tabular-nums ${
                            contact.lead_score >= 80
                              ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                              : contact.lead_score >= 50
                              ? 'bg-purple-950/80 text-purple-300 border border-purple-800/60'
                              : 'bg-[var(--bg-ground,#08090C)] text-[var(--text-muted,#718096)] border border-[var(--border-subtle,#1E2638)]'
                          }`}
                        >
                          Score {contact.lead_score}
                        </span>
                      </div>

                      {/* Shared Memory Summary Preview */}
                      {contact.shared_memory_summary && (
                        <p className="mt-2 text-[11px] text-[var(--text-secondary,#A0AEC0)] line-clamp-2 leading-relaxed bg-[var(--bg-ground,#08090C)]/60 p-1.5 rounded border border-[var(--border-subtle,#1E2638)]/60">
                          {contact.shared_memory_summary}
                        </p>
                      )}

                      {/* Estimated Value & Stage Shifter */}
                      <div className="mt-3 pt-2.5 border-t border-[var(--border-subtle,#1E2638)] flex items-center justify-between">
                        <span className="text-xs font-mono font-bold text-[var(--accent-primary,#00F5D4)] tabular-nums">
                          {Number(contact.estimated_value_dkk).toLocaleString(isDanish ? 'da-DK' : 'en-US')} DKK
                        </span>

                        {/* Move Stage Selector */}
                        <div
                          className="flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <select
                            value={contact.pipeline_stage}
                            onChange={(e) =>
                              optimisticMoveDealStage(contact.id, e.target.value as PipelineStage)
                            }
                            className="text-[10px] bg-[var(--bg-ground,#08090C)] hover:bg-[var(--bg-raised,#121824)] text-[var(--text-secondary,#8E9CAE)] rounded px-1.5 py-0.5 border border-[var(--border-subtle,#1E2638)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary,#00F5D4)] cursor-pointer"
                          >
                            {STAGES.map((s) => (
                              <option key={s.key} value={s.key}>
                                {isDanish ? s.titleDa : s.titleEn}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>

                {/* Empty State per Column */}
                {stageContacts.length === 0 && (
                  <div className="py-12 text-center border border-dashed border-[var(--border-subtle,#1E2638)] rounded-xl">
                    <p className="text-xs text-[var(--text-muted,#718096)] font-medium">
                      {isDanish ? 'Ingen sager' : 'No leads'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
