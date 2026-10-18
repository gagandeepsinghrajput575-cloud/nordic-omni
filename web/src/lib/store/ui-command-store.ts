import { create } from 'zustand';
import {
  Tenant,
  Contact,
  CallLog,
  OmnichannelMessage,
  UICommandEvent,
  PipelineStage,
  PricingItem,
  BusinessHours,
  UICommandType,
} from '@/contracts/schemas';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

export type UIStateStatus = 'empty' | 'skeleton' | 'error' | 'stale' | 'submitting' | 'ready';
export type ConsultPhase = 'idle' | 'ringing' | 'consulting' | 'relaying' | 'merged';
export interface ActiveDireAlert {
  callLogId?: string;
  customerName?: string;
  phoneNumber?: string;
  reason?: string;
  estimatedValueDkk?: number;
  aiBriefing?: string;
}

export interface UICommandState {
  // 5-State Life-cycle
  status: UIStateStatus;
  errorMessage: string | null;
  isStale: boolean;
  lastSyncTimestamp: number;

  // Active Tenant Context
  currentTenant: Tenant | null;
  tenantsList: Tenant[];

  // Entities
  contacts: Contact[];
  callLogs: CallLog[];
  messages: OmnichannelMessage[];

  // Reactive UI Focus Triggers (Bi-directional Command Bus)
  focusedScorecardId: string | null;
  activePipelineFilter: PipelineStage | 'all';
  activeContactId: string | null;
  highlightedPricingId: string | null;
  highlightedDayKey: string | null;

  // Dire Transfer Modal Console State ($0 WebRTC Consult / Merge)
  isDireModalOpen: boolean;
  direCallLog: CallLog | null;
  direContact: Contact | null;
  activeDireAlert: ActiveDireAlert | null;
  consultPhase: ConsultPhase;
  ownerWhisperInput: string;

  // Actions
  setStatus: (status: UIStateStatus) => void;
  setErrorMessage: (msg: string | null) => void;
  setCurrentTenant: (tenant: Tenant) => void;
  setTenantsList: (tenants: Tenant[]) => void;
  setContacts: (contacts: Contact[]) => void;
  setCallLogs: (callLogs: CallLog[]) => void;

  // Optimistic Mutations with Rollback
  optimisticMoveDealStage: (contactId: string, newStage: PipelineStage) => Promise<void>;
  optimisticUpdatePricing: (pricingItem: PricingItem) => Promise<void>;
  optimisticUpdateBroadcast: (broadcast: string | null) => Promise<void>;

  // Realtime UI Command Dispatcher
  handleRealtimeUICommand: (event: UICommandEvent) => void;
  executeUICommand: (commandType: UICommandType, payload: Record<string, unknown>) => void;

  // UI Control Triggers
  focusScorecard: (metricId: string | null) => void;
  setPipelineFilter: (stage: PipelineStage | 'all') => void;
  openContactDrawer: (contactId: string | null) => void;
  setHighlightedPricing: (pricingId: string | null) => void;
  setHighlightedDay: (dayKey: string | null) => void;

  // Dire Transfer Actions
  triggerDireModal: (alertOrCallLog: CallLog | ActiveDireAlert, contact?: Contact | null) => void;
  clearDireAlert: () => void;
  closeDireModal: () => void;
  setConsultPhase: (phase: ConsultPhase) => void;
  setOwnerWhisperInput: (text: string) => void;

  // Initialization & Realtime Wiring
  subscribeToTenantEvents: (tenantId: string) => () => void;
}

export const useUICommandStore = create<UICommandState>((set, get) => ({
  status: 'skeleton',
  errorMessage: null,
  isStale: false,
  lastSyncTimestamp: Date.now(),

  currentTenant: null,
  tenantsList: [],

  contacts: [],
  callLogs: [],
  messages: [],

  focusedScorecardId: null,
  activePipelineFilter: 'all',
  activeContactId: null,
  highlightedPricingId: null,
  highlightedDayKey: null,

  isDireModalOpen: false,
  direCallLog: null,
  direContact: null,
  activeDireAlert: null,
  consultPhase: 'idle',
  ownerWhisperInput: '',

  setStatus: (status) => set({ status }),
  setErrorMessage: (errorMessage) => set({ errorMessage }),
  setCurrentTenant: (currentTenant) => set({ currentTenant, status: 'ready' }),
  setTenantsList: (tenantsList) => set({ tenantsList }),
  setContacts: (contacts) => set({ contacts }),
  setCallLogs: (callLogs) => set({ callLogs }),

  optimisticMoveDealStage: async (contactId: string, newStage: PipelineStage) => {
    const previousContacts = get().contacts;
    const targetContact = previousContacts.find((c) => c.id === contactId);
    if (!targetContact) return;

    // Apply Optimistic Update
    set({
      contacts: previousContacts.map((c) =>
        c.id === contactId ? { ...c, pipeline_stage: newStage, updated_at: new Date().toISOString() } : c
      ),
    });

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase
        .from('contacts')
        .update({ pipeline_stage: newStage, updated_at: new Date().toISOString() })
        .eq('id', contactId);

      if (error) {
        throw new Error(error.message);
      }
    } catch (err: unknown) {
      // Rollback to previous state on failure
      const errorMsg = err instanceof Error ? err.message : 'Failed to update pipeline stage';
      set({ contacts: previousContacts, errorMessage: errorMsg, isStale: true });
    }
  },

  optimisticUpdatePricing: async (updatedItem: PricingItem) => {
    const currentTenant = get().currentTenant;
    if (!currentTenant) return;

    const previousCatalog = currentTenant.pricing_catalog;
    const newCatalog = previousCatalog.map((item) =>
      item.id === updatedItem.id ? updatedItem : item
    );

    set({
      currentTenant: { ...currentTenant, pricing_catalog: newCatalog },
      highlightedPricingId: updatedItem.id,
    });

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase
        .from('tenants')
        .update({ pricing_catalog: newCatalog, updated_at: new Date().toISOString() })
        .eq('id', currentTenant.id);

      if (error) throw new Error(error.message);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Pricing update failed';
      set({
        currentTenant: { ...currentTenant, pricing_catalog: previousCatalog },
        errorMessage: errorMsg,
      });
    }
  },

  optimisticUpdateBroadcast: async (broadcast: string | null) => {
    const currentTenant = get().currentTenant;
    if (!currentTenant) return;

    const previousBroadcast = currentTenant.active_broadcast_message;
    set({
      currentTenant: { ...currentTenant, active_broadcast_message: broadcast },
    });

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase
        .from('tenants')
        .update({ active_broadcast_message: broadcast, updated_at: new Date().toISOString() })
        .eq('id', currentTenant.id);

      if (error) throw new Error(error.message);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Broadcast update failed';
      set({
        currentTenant: { ...currentTenant, active_broadcast_message: previousBroadcast },
        errorMessage: errorMsg,
      });
    }
  },

  handleRealtimeUICommand: (event: UICommandEvent) => {
    const { command_type, payload } = event;

    switch (command_type) {
      case 'FOCUS_SCORECARD': {
        const metricId =
          typeof payload.metricId === 'string'
            ? payload.metricId
            : typeof payload.metric === 'string'
            ? payload.metric
            : null;
        set({ focusedScorecardId: metricId });
        break;
      }
      case 'FILTER_PIPELINE': {
        const stage =
          (payload.stage as PipelineStage | 'all') ||
          (payload.highlight_stage as PipelineStage | 'all') ||
          'all';
        set({ activePipelineFilter: stage });
        break;
      }
      case 'OPEN_CONTACT_DRAWER': {
        const contactId = typeof payload.contactId === 'string' ? payload.contactId : null;
        set({ activeContactId: contactId });
        break;
      }
      case 'HIGHLIGHT_AVAILABILITY': {
        const dayKey =
          typeof payload.dayKey === 'string'
            ? payload.dayKey
            : typeof payload.day === 'string'
            ? payload.day.toLowerCase().substring(0, 3)
            : null;
        set({ highlightedDayKey: dayKey });
        break;
      }
      case 'HIGHLIGHT_PRICING': {
        const pricingId =
          typeof payload.pricingId === 'string'
            ? payload.pricingId
            : typeof payload.title === 'string'
            ? payload.title
            : null;
        set({ highlightedPricingId: pricingId });
        break;
      }
      case 'TRIGGER_DIRE_MODAL': {
        const callLogId = typeof payload.callLogId === 'string' ? payload.callLogId : '';
        const matchingCall = get().callLogs.find((cl) => cl.id === callLogId) || null;
        const contactId = typeof payload.contactId === 'string' ? payload.contactId : '';
        const matchingContact = get().contacts.find((c) => c.id === contactId) || null;

        if (matchingCall) {
          get().triggerDireModal(matchingCall, matchingContact);
        } else {
          // Robust fallback: open Dire Modal directly from payload parameters
          const alert: ActiveDireAlert = {
            callLogId,
            customerName:
              typeof payload.customerName === 'string'
                ? payload.customerName
                : matchingContact?.full_name || 'Inbound Caller',
            phoneNumber:
              typeof payload.phoneNumber === 'string'
                ? payload.phoneNumber
                : matchingContact?.phone_number || '',
            reason:
              typeof payload.reason === 'string'
                ? payload.reason
                : 'high_value_emergency',
            estimatedValueDkk:
              typeof payload.estimatedValueDkk === 'number'
                ? payload.estimatedValueDkk
                : matchingContact?.estimated_value_dkk || 0,
            aiBriefing:
              typeof payload.aiBriefing === 'string'
                ? payload.aiBriefing
                : 'Dire escalation triggered.',
          };
          get().triggerDireModal(alert, matchingContact);
        }
        break;
      }
      case 'PULSE_METRIC': {
        const metricId = typeof payload.metricId === 'string' ? payload.metricId : null;
        set({ focusedScorecardId: metricId });
        setTimeout(() => set({ focusedScorecardId: null }), 3000);
        break;
      }
    }
  },

  executeUICommand: (commandType: UICommandType, payload: Record<string, unknown>) => {
    get().handleRealtimeUICommand({
      id: crypto.randomUUID(),
      tenant_id: get().currentTenant?.id || '',
      command_type: commandType,
      payload,
      created_at: new Date().toISOString(),
    });
  },

  focusScorecard: (focusedScorecardId) => set({ focusedScorecardId }),
  setPipelineFilter: (activePipelineFilter) => set({ activePipelineFilter }),
  openContactDrawer: (activeContactId) => set({ activeContactId }),
  setHighlightedPricing: (highlightedPricingId) => set({ highlightedPricingId }),
  setHighlightedDay: (highlightedDayKey) => set({ highlightedDayKey }),

  triggerDireModal: (alertOrCallLog, contact = null) => {
    const isCallLog = 'room_name' in alertOrCallLog;
    if (isCallLog) {
      const cl = alertOrCallLog as CallLog;
      set({
        isDireModalOpen: true,
        direCallLog: cl,
        direContact: contact,
        activeDireAlert: {
          callLogId: cl.id,
          customerName: contact?.full_name || 'Caller (+45)',
          phoneNumber: contact?.phone_number || '',
          reason: cl.dire_reason || 'high_value_emergency',
          estimatedValueDkk: contact?.estimated_value_dkk || 0,
          aiBriefing: cl.summary || 'Dire situation triggered during voice call.',
        },
        consultPhase: 'ringing',
      });
    } else {
      const alert = alertOrCallLog as ActiveDireAlert;
      set({
        isDireModalOpen: true,
        activeDireAlert: alert,
        consultPhase: 'ringing',
      });
    }
  },
  clearDireAlert: () =>
    set({
      isDireModalOpen: false,
      activeDireAlert: null,
      direCallLog: null,
      direContact: null,
      consultPhase: 'idle',
      ownerWhisperInput: '',
    }),
  closeDireModal: () =>
    set({
      isDireModalOpen: false,
      activeDireAlert: null,
      direCallLog: null,
      direContact: null,
      consultPhase: 'idle',
      ownerWhisperInput: '',
    }),
  setConsultPhase: (consultPhase) => set({ consultPhase }),
  setOwnerWhisperInput: (ownerWhisperInput) => set({ ownerWhisperInput }),

  subscribeToTenantEvents: (tenantId: string) => {
    const supabase = getSupabaseBrowserClient();

    const channel = supabase
      .channel(`tenant_${tenantId}_bus`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ui_command_events', filter: `tenant_id=eq.${tenantId}` },
        (payload) => {
          const rawEvent = payload.new as UICommandEvent;
          get().handleRealtimeUICommand(rawEvent);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'contacts', filter: `tenant_id=eq.${tenantId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            set((state) => ({ contacts: [payload.new as Contact, ...state.contacts] }));
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as Contact;
            set((state) => ({
              contacts: state.contacts.map((c) => (c.id === updated.id ? updated : c)),
            }));
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'call_logs', filter: `tenant_id=eq.${tenantId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newCall = payload.new as CallLog;
            set((state) => ({ callLogs: [newCall, ...state.callLogs] }));
            if (newCall.status === 'dire_hold_for_owner') {
              const matchedContact = get().contacts.find((c) => c.id === newCall.contact_id) || null;
              get().triggerDireModal(newCall, matchedContact);
            }
          } else if (payload.eventType === 'UPDATE') {
            const updatedCall = payload.new as CallLog;
            set((state) => ({
              callLogs: state.callLogs.map((cl) => (cl.id === updatedCall.id ? updatedCall : cl)),
            }));
            if (updatedCall.status === 'dire_hold_for_owner' && !get().isDireModalOpen) {
              const matchedContact = get().contacts.find((c) => c.id === updatedCall.contact_id) || null;
              get().triggerDireModal(updatedCall, matchedContact);
            }
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          set({ isStale: false, lastSyncTimestamp: Date.now() });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          set({ isStale: true });
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  },
}));
