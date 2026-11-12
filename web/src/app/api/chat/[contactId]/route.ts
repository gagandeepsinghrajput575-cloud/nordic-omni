import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  appendChatMessage,
  loadChatContext,
  loadChatMessages,
  mergeContactMemory,
  recordChatEstimate,
  requestChatInspection,
  updateChatContactState,
} from '@/lib/db/chat';
import { generateChatTurn } from '@/lib/ai/customer-chat';
import { recordEscalation, type EscalationReason } from '@/lib/ai/escalation';
import { calculateEstimate } from '@/lib/estimation';
import { FixedWindowRateLimiter } from '@/lib/livekit/policy';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({ message: z.string().trim().min(1).max(700) });
const limiter = new FixedWindowRateLimiter(20, 5 * 60_000);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ip(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    '127.0.0.1'
  );
}

function deterministicEscalation(
  text: string,
  policy: Record<string, unknown>,
): { reason: EscalationReason; briefing: string } | null {
  const normalized = text.toLowerCase();
  const emergency = [
    ...((policy.emergency_keywords as string[] | undefined) ?? []),
    ...((policy.emergencies as string[] | undefined) ?? []),
    'brand', 'gaslæk', 'strømstød', 'kollaps', 'ulovlig', 'sikkerhedsrisiko',
  ].map((value) => String(value).toLowerCase());
  if (emergency.some((keyword) => keyword.length > 2 && normalized.includes(keyword))) {
    return {
      reason: 'high_value_emergency',
      briefing: `Akut eller sikkerhedskritisk henvendelse: ${text.slice(0, 500)}`,
    };
  }
  if (/(menneske|rigtig person|chef|ejer|tale med en person|human|real person|manager|owner)/i.test(text)) {
    return { reason: 'human_requested', briefing: `Kunden beder om en person: ${text.slice(0, 500)}` };
  }
  if (/(elendig|skandal|sur|vred|rasende|fucking|usmagelig|advokat|lawyer|sue|klage)/i.test(text)) {
    return { reason: 'angry_customer', briefing: `Kunden er vred eller truer med klage: ${text.slice(0, 500)}` };
  }
  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ contactId: string }> },
) {
  const { contactId } = await params;
  if (!UUID.test(contactId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!limiter.allow(`${contactId}:${ip(request)}`)) {
    return NextResponse.json(
      { error: 'Too many messages. Try again shortly.' },
      { status: 429, headers: { 'Retry-After': '300' } },
    );
  }

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Write a short message first.' }, { status: 400 });
  }
  const text = parsed.data.message;

  const context = await loadChatContext(contactId);
  if (!context || context.tenant.status !== 'active') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const inbound = await appendChatMessage({
    tenantId: context.tenant.id,
    contactId,
    channel: 'web_chat',
    direction: 'inbound',
    sender: 'customer',
    content: text,
    metadata: { source: 'public_chat' },
  });

  if (context.tenant.reception_mode === 'human_forward') {
    return NextResponse.json({ ok: true, handedOver: true, reply: null,
      notice: context.contact.preferred_language.startsWith('da') ? 'Kontoret håndterer opkald personligt. Ring til hovednummeret.' : 'This office handles calls personally. Please call the main number.', message: inbound });
  }
  if (!context.contact.ai_auto_reply_enabled) {
    return NextResponse.json({
      ok: true,
      handedOver: true,
      reply: null,
      notice:
        context.contact.preferred_language.startsWith('da')
          ? 'Kontoret har overtaget denne samtale. Din besked er gemt.'
          : 'The office has taken over this conversation. Your message is saved.',
      message: inbound,
    });
  }

  const history = await loadChatMessages(context.tenant.id, contactId, 12);
  const result = await generateChatTurn(context, history);

  let estimateView: {
    minimum: number;
    maximum: number;
    midpoint: number;
    service: string;
    squareMeters: number | null;
    disclaimer: string;
  } | null = null;
  let estimateId: string | null = null;

  if (result.estimate) {
    try {
      const estimate = calculateEstimate(
        context.tenant.pricing_catalog,
        result.estimate.catalog_item_id,
        result.estimate.square_meters,
      );
      estimateId = await recordChatEstimate({
        tenantId: context.tenant.id,
        contactId,
        catalogItemId: result.estimate.catalog_item_id,
        projectType: result.estimate.project_type,
        scopeDetails: result.estimate.scope_details,
        squareMeters: estimate.squareMeters,
        minimum: estimate.minimum,
        maximum: estimate.maximum,
        midpoint: estimate.midpoint,
        followupNotes: result.estimate.followup_notes,
      });
      estimateView = {
        minimum: estimate.minimum,
        maximum: estimate.maximum,
        midpoint: estimate.midpoint,
        service: estimate.service,
        squareMeters: estimate.squareMeters,
        disclaimer:
          context.contact.preferred_language.startsWith('da')
            ? 'Vejledende overslag, ikke et bindende tilbud. En besigtigelse giver den sikre pris.'
            : 'A non-binding guide, not a fixed quote. An inspection gives the reliable price.',
      };
      if (
        context.contact.preferred_language.startsWith('da') &&
        !/ikke et bindende|vejledende/i.test(result.reply)
      ) {
        result.reply = `${result.reply} Det er et vejledende overslag, ikke et bindende tilbud.`;
      }
    } catch {
      result.reply = context.contact.preferred_language.startsWith('da')
        ? 'Den opgave kan jeg ikke give en sikker pris på endnu. En kollega skal bekræfte den efter en kort snak om omfanget.'
        : 'I cannot give a reliable price for that yet. A colleague must confirm it after a short conversation about scope.';
    }
  }

  let inspectionId: string | null = null;
  if (result.inspection_request) {
    inspectionId = await requestChatInspection({
      tenantId: context.tenant.id,
      contactId,
      requestedTimeText: result.inspection_request.requested_time_text,
      address: result.inspection_request.address,
      notes: result.inspection_request.notes,
    });
  }

  await mergeContactMemory(context.tenant.id, contactId, result.memory_update);
  await updateChatContactState(context.tenant.id, contactId, result.stage, result.lead_score);

  const forced = deterministicEscalation(text, context.agent.escalation_policy);
  const escalationWanted = forced ?? (result.escalation?.needed ? result.escalation : null);
  let escalationView: { status: string; delivered: boolean } | null = null;
  if (escalationWanted) {
    const outcome = await recordEscalation({
      tenant: context.tenant,
      contact: context.contact,
      channel: 'web_chat',
      reason: escalationWanted.reason,
      urgency: result.escalation?.urgency ?? (forced ? 4 : 3),
      briefing: escalationWanted.briefing,
    });
    escalationView = { status: outcome.status, delivered: outcome.delivered };
    if (forced?.reason === 'high_value_emergency') {
      await updateChatContactState(context.tenant.id, contactId, 'dire_escalated', 95);
    }
  }

  const assistant = await appendChatMessage({
    tenantId: context.tenant.id,
    contactId,
    channel: 'web_chat',
    direction: 'outbound',
    sender: 'ai',
    content: result.reply,
    metadata: {
      intent: result.intent,
      estimateId,
      inspectionId,
      escalation: escalationView,
      source: 'public_chat',
    },
  });

  return NextResponse.json({
    ok: true,
    handedOver: false,
    reply: result.reply,
    message: assistant,
    estimate: estimateView,
    inspection: inspectionId ? { recorded: true, confirmed: false } : null,
    escalation: escalationView,
  });
}

