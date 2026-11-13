import 'server-only';

import type { KnowledgeItem, OperatingHour, Workspace } from '@/db/schema';
import { maskingSafe } from '@/lib/ai/utils';
import { chunkForStream, localReceptionistReply } from '@/lib/ai/fallback';
import { providerClient, resolveProvider } from '@/lib/ai/config';
import {
  OpenAICompatibleError,
  type OpenAIChatMessage,
  type OpenAIToolCall,
} from '@/lib/ai/openai-client';
import { RECEPTIONIST_TOOLS, buildSystemPrompt, formatHours } from '@/lib/ai/prompts';
import type { Channel, ChatTurn, Language } from '@/lib/types';

export interface ReceptionistContext {
  workspace: Workspace;
  knowledge: KnowledgeItem[];
  hours: OperatingHour[];
  language: Language;
  history: ChatTurn[];
  callerName?: string;
  callerPhone?: string;
  channel: Channel;
}

export type ReceptionistEvent =
  | { type: 'meta'; mode: 'live' | 'local'; provider: string; model: string }
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string; summary: string }
  | { type: 'done'; text: string; latencyMs: number; leadCaptured: boolean; mode: 'live' | 'local' }
  | { type: 'error'; message: string };

interface ToolOutcome {
  result: string;
  summary: string;
  leadCaptured: boolean;
}

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? value : '';
}

async function captureLead(
  workspaceId: string,
  args: Record<string, unknown>,
  context: ReceptionistContext
): Promise<ToolOutcome> {
  const name = readString(args, 'name').trim() || context.callerName || (context.language === 'da' ? 'Ukendt henvendelse' : 'Unknown enquiry');
  const phone = readString(args, 'phone').trim() || context.callerPhone || '';
  const intent = readString(args, 'intent').trim() || (context.language === 'da' ? 'Generel henvendelse' : 'General enquiry');

  if (!phone) {
    return {
      result: 'Lead not saved: a phone number is required. Ask the caller for their mobile number.',
      summary: 'Missing phone number — lead not saved',
      leadCaptured: false,
    };
  }

  const ref = `lead_${Date.now().toString(36)}`;
  return {
    result: `Lead saved with reference ${ref}. Confirm that a human will follow up shortly.`,
    summary: `${name} saved as lead · ${intent}`,
    leadCaptured: true,
  };
}

async function executeTool(
  call: OpenAIToolCall,
  context: ReceptionistContext
): Promise<ToolOutcome> {
  const args = parseArguments(call.function.arguments);
  switch (call.function.name) {
    case 'capture_lead':
      return captureLead(context.workspace.id, args, context);
    case 'get_operating_hours': {
      const day = readString(args, 'day');
      const scoped = day
        ? context.hours.filter((row) => row.dayOfWeek >= 0)
        : context.hours;
      return {
        result: `Opening hours for ${context.workspace.name}:\n${formatHours(scoped)}\nTimezone: ${context.workspace.timezone}. Human escalation: ${context.workspace.escalationPhone}.`,
        summary: 'Opening hours shared from schedule',
        leadCaptured: false,
      };
    }
    case 'escalate_call': {
      const reason = readString(args, 'reason') || 'Caller requested a human';
      return {
        result: `Escalation logged (${reason}). Warm transfer caller to ${context.workspace.escalationPhone}.`,
        summary: `Escalation → ${context.workspace.escalationPhone}`,
        leadCaptured: false,
      };
    }
    default:
      return {
        result: 'Unknown tool. Respond to the caller using grounded knowledge only.',
        summary: `Unsupported tool: ${call.function.name}`,
        leadCaptured: false,
      };
  }
}

function toProviderMessages(context: ReceptionistContext): OpenAIChatMessage[] {
  const system: OpenAIChatMessage = {
    role: 'system',
    content: buildSystemPrompt({
      workspace: context.workspace,
      knowledge: context.knowledge,
      hours: context.hours,
      language: context.language,
      callerName: context.callerName,
      callerPhone: context.callerPhone,
      channel: context.channel,
    }),
  };
  const history = context.history.slice(-12).map<OpenAIChatMessage>((turn) => ({
    role: turn.role,
    content: turn.content,
  }));
  return [system, ...history];
}

async function* localReplyStream(
  context: ReceptionistContext,
  startedAt: number
): AsyncGenerator<ReceptionistEvent> {
  const lastUserMessage = [...context.history].reverse().find((turn) => turn.role === 'user')?.content ?? '';
  const reply = localReceptionistReply(lastUserMessage, {
    workspace: context.workspace,
    knowledge: context.knowledge,
    hours: context.hours,
    language: context.language,
    history: context.history.slice(0, -1),
    callerName: context.callerName,
    callerPhone: context.callerPhone,
  });

  let leadCaptured = false;
  if (reply.lead) {
    const outcome = await captureLead(
      context.workspace.id,
      {
        name: reply.lead.name,
        phone: reply.lead.phone,
        intent: reply.lead.intent,
        urgency: reply.lead.urgency,
        notes: 'Captured by the local grounded receptionist',
      },
      context
    );
    leadCaptured = outcome.leadCaptured;
    yield { type: 'tool', name: 'capture_lead', summary: outcome.summary };
  } else if (reply.tool === 'escalate_call') {
    yield {
      type: 'tool',
      name: 'escalate_call',
      summary: `Escalation → ${context.workspace.escalationPhone}`,
    };
  } else if (reply.tool === 'get_operating_hours') {
    yield { type: 'tool', name: 'get_operating_hours', summary: 'Opening hours shared from schedule' };
  }

  for (const chunk of chunkForStream(reply.text)) {
    yield { type: 'delta', text: chunk };
    await new Promise((resolve) => setTimeout(resolve, 16));
  }

  yield {
    type: 'done',
    text: reply.text,
    latencyMs: Math.max(1, Date.now() - startedAt),
    leadCaptured,
    mode: 'local',
  };
}

export async function* streamReceptionistReply(
  context: ReceptionistContext
): AsyncGenerator<ReceptionistEvent> {
  const startedAt = Date.now();
  const provider = resolveProvider(context.workspace);
  const mode: 'live' | 'local' = provider.configured ? 'live' : 'local';

  yield {
    type: 'meta',
    mode,
    provider: mode === 'live' ? maskingSafe(provider.label) : 'Nordic-Omni grounded brain',
    model: provider.model,
  };

  if (mode === 'local') {
    yield* localReplyStream(context, startedAt);
    return;
  }

  const client = providerClient(provider);
  const messages = toProviderMessages(context);
  let finalText = '';
  let leadCaptured = false;

  try {
    for (let round = 0; round < 3; round += 1) {
      let roundText = '';
      let toolCalls: OpenAIToolCall[] = [];

      for await (const event of client.streamChat({
        messages,
        tools: RECEPTIONIST_TOOLS,
        toolChoice: 'auto',
        temperature: 0.35,
        maxTokens: 360,
      })) {
        if (event.type === 'text') {
          roundText += event.text;
          finalText += event.text;
          yield { type: 'delta', text: event.text };
        } else if (event.type === 'tool_calls') {
          toolCalls = event.toolCalls;
        } else if (event.type === 'error') {
          throw new OpenAICompatibleError(event.message);
        }
      }

      if (toolCalls.length === 0) {
        break;
      }

      messages.push({
        role: 'assistant',
        content: roundText || null,
        tool_calls: toolCalls,
      });

      for (const call of toolCalls) {
        const outcome = await executeTool(call, context);
        if (outcome.leadCaptured) leadCaptured = true;
        yield { type: 'tool', name: call.function.name, summary: outcome.summary };
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: outcome.result,
        });
      }
    }

    if (finalText.trim().length === 0) {
      yield { type: 'tool', name: 'provider_fallback', summary: 'Empty provider response — local brain engaged' };
      yield* localReplyStream(context, startedAt);
      return;
    }

    yield {
      type: 'done',
      text: finalText,
      latencyMs: Math.max(1, Date.now() - startedAt),
      leadCaptured,
      mode: 'live',
    };
  } catch (error) {
    yield {
      type: 'tool',
      name: 'provider_error',
      summary: `${describeProviderError(error)} — local brain engaged`,
    };
    yield* localReplyStream(context, startedAt);
  }
}

export function describeProviderError(error: unknown): string {
  if (error instanceof OpenAICompatibleError) {
    return error.status ? `${error.message} (HTTP ${error.status})` : error.message;
  }
  return error instanceof Error ? error.message : 'Unknown provider error';
}
