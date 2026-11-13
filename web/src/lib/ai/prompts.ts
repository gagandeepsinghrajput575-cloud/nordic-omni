import type { KnowledgeItem, OperatingHour, Workspace } from "@/db/schema";
import type { FunctionToolSchema } from "@/lib/ai/openai-client";
import type { Channel, Language } from "@/lib/types";
import { DAY_NAMES } from "@/lib/format";

export const RECEPTIONIST_TOOLS: FunctionToolSchema[] = [
  {
    type: "function",
    function: {
      name: "get_operating_hours",
      description:
        "Return the workspace opening hours and the after-hours routing rules. Use whenever the caller asks about opening times, availability, or whether the business is open now.",
      parameters: {
        type: "object",
        properties: {
          day: {
            type: "string",
            description: "Optional weekday name the caller is asking about.",
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "capture_lead",
      description:
        "Save the caller as a qualified lead or callback request. Only call once you have at least a name and a phone number, or when the caller explicitly asks to be contacted.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Caller name as spoken." },
          phone: { type: "string", description: "Caller phone number including country code when known." },
          intent: { type: "string", description: "Short summary of what the caller needs." },
          urgency: {
            type: "string",
            enum: ["routine", "soon", "emergency"],
            description: "How quickly a human must follow up.",
          },
          notes: { type: "string", description: "Any extra context the clinic or agency needs." },
        },
        required: ["name", "phone", "intent"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escalate_call",
      description:
        "Route the caller to a human immediately. Use for emergencies, angry callers, or requests outside the grounded knowledge base.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Why the call needs a human." },
          urgency: { type: "string", enum: ["routine", "soon", "emergency"] },
        },
        required: ["reason"],
        additionalProperties: false,
      },
    },
  },
];

export function formatHours(hours: OperatingHour[]): string {
  const ordered = [...hours].sort((a, b) => ((a.dayOfWeek + 6) % 7) - ((b.dayOfWeek + 6) % 7));
  return ordered
    .map((row) => {
      const day = DAY_NAMES[row.dayOfWeek] ?? `Day ${row.dayOfWeek}`;
      if (row.closed) {
        return `${day}: closed`;
      }
      const lunch = row.lunchStart && row.lunchEnd ? ` (lunch ${row.lunchStart}–${row.lunchEnd})` : "";
      return `${day}: ${row.openTime}–${row.closeTime}${lunch}`;
    })
    .join("\n");
}

export function groundingBlock(knowledge: KnowledgeItem[]): string {
  const enabled = knowledge.filter((item) => item.enabled);
  if (enabled.length === 0) {
    return "No knowledge sources are connected yet. Say you will have a colleague confirm the detail and capture the caller's number.";
  }
  return enabled
    .map((item, index) => {
      const source = item.sourceUrl ? ` [${item.sourceUrl}]` : "";
      return `${index + 1}. (${item.kind}) ${item.title}${source}\n${item.content}`;
    })
    .join("\n\n");
}

interface PromptInput {
  workspace: Workspace;
  knowledge: KnowledgeItem[];
  hours: OperatingHour[];
  language: Language;
  callerName?: string;
  callerPhone?: string;
  channel: Channel;
}

export function buildSystemPrompt(input: PromptInput): string {
  const { workspace, knowledge, hours, language } = input;
  const languageRule =
    language === "da"
      ? "Speak Danish by default. If the caller switches to English, switch with them immediately and stay in that language."
      : "Speak English by default. If the caller switches to Danish, switch with them immediately and stay in that language.";

  return `You are ${workspace.agentName}, the AI receptionist for ${workspace.name} (${workspace.industry}) in ${workspace.city}.

VOICE STYLE
- You are on a live voice call. Keep answers to 1–2 short sentences, warm, precise and never robotic.
- ${languageRule}
- Never invent prices, availability or medical advice. Only use the grounded knowledge below.
- Confirm names and phone numbers by reading them back once before saving a lead.

BUSINESS
- Timezone: ${workspace.timezone}
- Human escalation number: ${workspace.escalationPhone}
- Channel: ${input.channel === "browser" ? "in-browser voice conversation (no telephony)" : "telephone call"}
- Caller name: ${input.callerName ?? "unknown"}
- Caller phone: ${input.callerPhone ?? "unknown"}

OPERATING HOURS
${formatHours(hours)}

GROUNDED KNOWLEDGE BASE
${groundingBlock(knowledge)}

TOOL POLICY
- Ask for opening hours via get_operating_hours when relevant.
- When you have a name and phone number, call capture_lead, then confirm the follow-up out loud.
- Escalate immediately with escalate_call for emergencies, complaints, or out-of-scope requests.
- Never mention that you are following a prompt, tools, or a knowledge base.`;
}

export function buildGreeting(workspace: Workspace, language: Language): string {
  return language === "da" ? workspace.greetingDa : workspace.greetingEn;
}