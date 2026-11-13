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

export type TelephonyMode = "webrtc" | "sip";
export type RingBehavior = "immediate" | "one-ring" | "two-rings";
export type SipCodec = "PCMA" | "PCMU" | "OPUS" | "AMR-WB";
export type SipSessionState = "ringing" | "connected" | "completed" | "failed" | "missed";
export type PersonaVoiceModel =
  | "azure-christel"
  | "azure-jeppe"
  | "elevenlabs-turbo-da"
  | "azure-sofie";

export interface TelephonyNumberView {
  id: string;
  e164: string;
  pretty: string;
  country: string;
  label: string;
  provider: string;
  carrier: string;
  sipTrunkHost: string;
  sipUsername: string;
  sipPassword: string;
  sipEndpoint: string;
  dispatchRuleId: string | null;
  mode: TelephonyMode;
  ringBehavior: RingBehavior;
  codec: SipCodec;
  sampleRate: number;
  status: string;
  healthScore: number;
  jitterMs: number;
  packetLoss: number;
  monthlyCostDkk: number;
  lastCallAt: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  workspaceSlug: string | null;
  agentName: string | null;
  calls24h: number;
}

export interface SipSessionView {
  id: string;
  roomName: string;
  callerNumber: string | null;
  dialedNumber: string | null;
  workspaceName: string | null;
  agentName: string | null;
  state: string;
  codec: string;
  ringDelayMs: number;
  sttLatencyMs: number;
  llmFirstTokenMs: number;
  ttsFirstByteMs: number;
  roundTripMs: number;
  jitterMs: number;
  packetLossPct: number;
  mos: number;
  transcriptPreview: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface TelephonyHealth {
  trunkStatus: "active" | "degraded" | "down";
  dispatchHealthy: boolean;
  numbersTotal: number;
  numbersOnline: number;
  inbound24h: number;
  avgRoundTripMs: number;
  avgRingDelayMs: number;
  avgMos: number;
  jitterMs: number;
  packetLossPct: number;
  codecDistribution: { codec: string; count: number }[];
}

export interface SoundProfile {
  voiceModel: PersonaVoiceModel;
  telephonyEq: string;
  speechRate: number;
  vadThreshold: number;
  bargeInSensitivity: number;
  gainDb: number;
  comfortNoise: boolean;
  fillersDa: boolean;
}
