export type Language = "da" | "en";
export type VoiceState = "idle" | "listening" | "speaking" | "thinking" | "muted";
export type Channel = "browser" | "phone";
export type AfterHoursRouting = "callback" | "voicemail" | "emergency" | "human";
export type KnowledgeKind = "fact" | "faq" | "document" | "website";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface TranscriptMessage {
  id: string;
  role: "agent" | "caller";
  text: string;
  at: string;
}

export interface DigestBucket {
  key: string;
  label: string;
  calls: number;
  leads: number;
  qualified: number;
}

export interface DigestSummary {
  windowLabel: string;
  totalCalls: number;
  qualifiedLeads: number;
  newLeads: number;
  avgDurationSeconds: number;
  afterHoursCalls: number;
  missedCalls: number;
  buckets: DigestBucket[];
}

export interface OpenState {
  isOpen: boolean;
  headline: string;
  detail: string;
  localTime: string;
}

export interface ProviderStatus {
  configured: boolean;
  label: string;
  baseURL: string;
  model: string;
  source: "workspace" | "environment" | "none";
  apiKeyHint: string;
}

export interface TestConnectionResult {
  ok: boolean;
  latencyMs: number;
  model: string;
  baseUrl: string;
  message: string;
  sample?: string;
  saved?: boolean;
}

export type ShowcaseEventAction = "view" | "conversation";

export interface ApiError {
  error: string;
}