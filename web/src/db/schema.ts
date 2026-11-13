export type TranscriptTurn = {
  role: "agent" | "caller";
  text: string;
  at: string;
  lang?: "da" | "en";
};

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  kind: string;
  agencyId?: string | null;
  industry: string;
  city: string;
  timezone: string;
  defaultLanguage: string;
  agentName: string;
  voiceModel: string;
  greetingDa: string;
  greetingEn: string;
  escalationPhone: string;
  providerLabel?: string | null;
  providerBaseUrl?: string | null;
  providerApiKey?: string | null;
  providerModel?: string | null;
  digestEmail?: string | null;
  digestEnabled: boolean;
  createdAt: Date;
}

export interface Contact {
  id: string;
  workspaceId: string;
  name: string;
  phone: string;
  company?: string | null;
  kind: string;
  lastContactAt?: Date | null;
  createdAt: Date;
}

export interface KnowledgeItem {
  id: string;
  workspaceId: string;
  kind: "fact" | "faq" | "document" | "website";
  title: string;
  content: string;
  sourceUrl?: string | null;
  enabled: boolean;
  tokenCount: number;
  createdAt: Date;
}

export interface OperatingHour {
  id: string;
  workspaceId: string;
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  closed: boolean;
  lunchStart?: string | null;
  lunchEnd?: string | null;
}

export interface Lead {
  id: string;
  workspaceId: string;
  name: string;
  phone: string;
  intent: string;
  urgency: "routine" | "soon" | "emergency";
  summary: string;
  status: "new" | "contacted" | "qualified" | "closed";
  channel: "browser" | "phone";
  createdAt: Date;
}

export interface Call {
  id: string;
  workspaceId: string;
  contactId?: string | null;
  channel: "browser" | "phone";
  callerNumber?: string | null;
  callerName?: string | null;
  direction: "inbound" | "outbound";
  status: "completed" | "missed" | "failed";
  durationSeconds: number;
  transcript: TranscriptTurn[];
  summary?: string | null;
  endedReason?: string | null;
  leadCaptured: boolean;
  createdAt: Date;
}

export interface ProviderCheck {
  id: string;
  workspaceId: string;
  provider: string;
  model: string;
  baseURL: string;
  latencyMs: number;
  status: "ok" | "failed";
  errorMessage?: string | null;
  createdAt: Date;
}

export interface Showcase {
  id: string;
  workspaceId: string;
  slug: string;
  title: string;
  subtitle: string;
  partnerName: string;
  language: string;
  enabled: boolean;
  accessCount: number;
  callCount: number;
  leadCount: number;
  createdAt: Date;
}
