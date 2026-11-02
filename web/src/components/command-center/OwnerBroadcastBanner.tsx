'use client';

import React, { useState } from 'react';
import { Radio, Edit3, Check, X, Loader2 } from 'lucide-react';
import { useUICommandStore } from '@/lib/store/ui-command-store';
import { createClient } from '@/lib/supabase/client';

export function OwnerBroadcastBanner() {
  const currentTenant = useUICommandStore((state) => state.currentTenant);
  const setCurrentTenant = useUICommandStore((state) => state.setCurrentTenant);

  const [isEditing, setIsEditing] = useState(false);
  const [announcementText, setAnnouncementText] = useState(
    currentTenant?.active_broadcast_message || ''
  );
  const [isSaving, setIsSaving] = useState(false);

  const supabase = createClient();
  const isDanish = currentTenant?.default_language === 'da-DK';

  if (!currentTenant) return null;

  const handleSaveBroadcast = async () => {
    if (!currentTenant) return;
    setIsSaving(true);

    try {
      const trimmed = announcementText.trim();
      const updatedTenant = {
        ...currentTenant,
        active_broadcast_message: trimmed || null,
      };

      setCurrentTenant(updatedTenant);

      await supabase
        .from('tenants')
        .update({
          active_broadcast_message: trimmed || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', currentTenant.id);

      // Trigger UI Event to notify AI agent & other connected tabs
      await supabase.from('ui_command_events').insert({
        tenant_id: currentTenant.id,
        command_type: 'PULSE_METRIC',
        payload: {
          metricId: 'broadcast_update',
          message: trimmed,
          timestamp: Date.now(),
        },
      });

      setIsEditing(false);
    } catch (e) {
      console.error('Failed to update broadcast message:', e);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="w-full bg-[var(--bg-surface)] border-y border-[var(--border-subtle)] px-6 py-2.5 flex items-center justify-between text-xs transition-colors">
      <div className="flex items-center gap-3 flex-1 mr-4 overflow-hidden">
        {/* Tactical Status Badge */}
        <div className="px-2 py-0.5 rounded font-mono text-[10px] font-semibold tracking-wider uppercase border border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] shrink-0 flex items-center gap-1.5 select-none">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--accent-primary)] opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--accent-primary)]" />
          </span>
          <Radio className="w-3 h-3" />
          <span>{isDanish ? 'DRUFTSMEDDELELSE' : 'DISPATCH BROADCAST'}</span>
        </div>

        {/* Broadcast Content or Editor */}
        {isEditing ? (
          <div className="flex items-center gap-2 flex-1">
            <input
              type="text"
              value={announcementText}
              onChange={(e) => setAnnouncementText(e.target.value)}
              placeholder={
                isDanish
                  ? 'F.eks: Prioritering af akutte rørskader i kældre pga. stormvarsel...'
                  : 'e.g. Priority dispatch: Cold snap response units routing frozen pipe calls...'
              }
              className="flex-1 bg-[var(--bg-ground)] border border-[var(--accent-primary)] rounded px-3 py-1 font-mono text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveBroadcast();
                if (e.key === 'Escape') {
                  setAnnouncementText(currentTenant.active_broadcast_message || '');
                  setIsEditing(false);
                }
              }}
            />
            <button
              onClick={handleSaveBroadcast}
              disabled={isSaving}
              className="px-2.5 py-1 bg-[var(--accent-primary)] hover:opacity-90 text-[var(--accent-contrast)] font-mono text-xs font-semibold rounded transition-all flex items-center gap-1 shadow-sm disabled:opacity-50"
              title={isDanish ? 'Gem' : 'Save'}
            >
              {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              <span>{isDanish ? 'Gem' : 'Save'}</span>
            </button>
            <button
              onClick={() => {
                setAnnouncementText(currentTenant.active_broadcast_message || '');
                setIsEditing(false);
              }}
              className="px-2 py-1 bg-[var(--bg-raised)] hover:bg-[var(--border-subtle)] text-[var(--text-secondary)] font-mono text-xs rounded border border-[var(--border-subtle)] transition-all flex items-center gap-1"
              title={isDanish ? 'Annuller' : 'Cancel'}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <p className="text-[var(--text-primary)] truncate font-mono text-xs tracking-normal">
            {currentTenant.active_broadcast_message || (
              <span className="text-[var(--text-muted)] italic">
                {isDanish
                  ? 'Ingen aktiv driftsmeddelelse aktiv. AI-agent kører standard ruteprotokol.'
                  : 'No active broadcast set. AI agent operating under standard routing protocol.'}
              </span>
            )}
          </p>
        )}
      </div>

      {/* Edit Trigger Button */}
      {!isEditing && (
        <button
          onClick={() => {
            setAnnouncementText(currentTenant.active_broadcast_message || '');
            setIsEditing(true);
          }}
          className="flex items-center gap-1.5 font-mono text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-raised)] hover:bg-[var(--bg-ground)] border border-[var(--border-subtle)] hover:border-[var(--accent-primary)]/50 px-2.5 py-1 rounded transition-colors shrink-0"
        >
          <Edit3 className="w-3 h-3" />
          <span>{isDanish ? 'Rediger' : 'Update Broadcast'}</span>
        </button>
      )}
    </div>
  );
}
