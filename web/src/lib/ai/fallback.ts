import type { KnowledgeItem, OperatingHour, Workspace } from '@/db/schema';
import type { ChatTurn, Language } from '@/lib/types';

export interface LeadDraft {
  name: string;
  phone: string;
  intent: string;
  urgency: 'routine' | 'soon' | 'emergency';
}

export type LocalToolName = 'capture_lead' | 'get_operating_hours' | 'escalate_call';

export interface LocalReply {
  text: string;
  detectedLanguage: Language;
  lead?: LeadDraft;
  tool: LocalToolName | null;
  summary: string;
}

export interface LocalContext {
  workspace: Workspace;
  knowledge: KnowledgeItem[];
  hours: OperatingHour[];
  language: Language;
  history: ChatTurn[];
  callerName?: string;
  callerPhone?: string;
}

const PHONE_PATTERN = /(\+?\d[\d\s\-().]{6,}\d)/;
const DANISH_HINTS = ['hej', 'hvad', 'hvornår', 'kan', 'ikke', 'tak', 'gerne', 'pris', 'åbning', 'tid'];

function detectLanguage(text: string, fallback: Language): Language {
  const lower = text.toLowerCase();
  const hasDanish = DANISH_HINTS.some((h) => lower.includes(h)) || /[æøå]/i.test(text);
  return hasDanish ? 'da' : fallback;
}

function extractPhone(text: string): string | null {
  const match = text.match(PHONE_PATTERN);
  return match ? match[1].replace(/\s+/g, ' ').trim() : null;
}

export function localReceptionistReply(message: string, context: LocalContext): LocalReply {
  const lang = detectLanguage(message, context.language);
  const lower = message.toLowerCase();
  const phone = extractPhone(message) || context.callerPhone;

  // Emergency detection
  if (lower.includes('akut') || lower.includes('haster') || lower.includes('emergency') || lower.includes('urgent')) {
    const text = lang === 'da'
      ? `Jeg forstår, at det haster. Jeg logger straks denne akutte sag og stiller dig videre til ${context.workspace.escalationPhone}.`
      : `I understand this is urgent. I am escalating this immediately to ${context.workspace.escalationPhone}.`;
    return {
      text,
      detectedLanguage: lang,
      tool: 'escalate_call',
      summary: `Urgent escalation → ${context.workspace.escalationPhone}`,
      lead: phone ? { name: context.callerName || 'Urgent Caller', phone, intent: 'Urgent assistance', urgency: 'emergency' } : undefined,
    };
  }

  // Hours query
  if (lower.includes('åben') || lower.includes('luk') || lower.includes('hours') || lower.includes('open') || lower.includes('tid')) {
    const text = lang === 'da'
      ? `Vi har normalt åbent mandag til fredag fra kl. 08:00 til 16:00. Vores AI receptionist besvarer henvendelser døgnet rundt.`
      : `Our standard business hours are Monday through Friday, 08:00 to 16:00. Our AI receptionist answers inquiries 24/7.`;
    return {
      text,
      detectedLanguage: lang,
      tool: 'get_operating_hours',
      summary: 'Opening hours shared',
    };
  }

  // Lead / callback capture
  if (phone) {
    const text = lang === 'da'
      ? `Mange tak. Jeg har noteret dit telefonnummer (${phone}). En medarbejder fra ${context.workspace.name} ringer dig op hurtigst muligt.`
      : `Thank you. I have recorded your contact number (${phone}). A representative from ${context.workspace.name} will call you back shortly.`;
    return {
      text,
      detectedLanguage: lang,
      tool: 'capture_lead',
      summary: `Lead captured · ${phone}`,
      lead: { name: context.callerName || 'Henvendelse', phone, intent: 'Callback request', urgency: 'soon' },
    };
  }

  // Default grounded receptionist response
  const text = lang === 'da'
    ? `Tak for din henvendelse til ${context.workspace.name}. Hvad drejer din opgave sig om, og hvad er dit telefonnummer, hvis vi skal ringe dig op?`
    : `Thank you for contacting ${context.workspace.name}. How can we assist you today, and what is your phone number if we need to call you back?`;

  return {
    text,
    detectedLanguage: lang,
    tool: null,
    summary: 'General reception inquiry',
  };
}

export function chunkForStream(text: string): string[] {
  const words = text.split(' ');
  const chunks: string[] = [];
  let current = '';
  words.forEach((word, index) => {
    current += index === 0 ? word : ` ${word}`;
    if (current.split(' ').length >= 4 || index === words.length - 1) {
      chunks.push(current);
      current = '';
    }
  });
  return chunks;
}
