import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
);

// GET: Meta Webhook Subscription Verification (hub.challenge handshake)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const verifyToken = process.env.META_VERIFY_TOKEN || 'nordic_omni_secret_token';

  if (mode === 'subscribe' && token === verifyToken) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

// POST: Meta WhatsApp / Instagram Inbound Message Ingestion
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json();

    const entry = rawBody.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const incomingMessages = value?.messages || [];

    if (!incomingMessages || incomingMessages.length === 0) {
      return NextResponse.json({ status: 'NO_MESSAGES_TO_PROCESS' }, { status: 200 });
    }

    const messageItem = incomingMessages[0];
    const senderNumber = messageItem.from || '+4500000000';
    const messageText = messageItem.text?.body || messageItem.body || '';
    const contactProfile = value?.contacts?.[0]?.profile?.name || 'WhatsApp Lead';

    // 1. Resolve Tenant (Map to primary tenant or phone number ID)
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    if (!tenant) {
      return NextResponse.json({ error: 'No active tenant found' }, { status: 404 });
    }

    // 2. Resolve Contact
    let contactId = '';
    const { data: existingContact } = await supabaseAdmin
      .from('contacts')
      .select('*')
      .eq('tenant_id', tenant.id)
      .eq('phone_number', senderNumber)
      .maybeSingle();

    const lower = messageText.toLowerCase();
    const wantsCall =
      lower.includes('ring') ||
      lower.includes('call') ||
      lower.includes('telefon') ||
      lower.includes('opkald') ||
      lower.includes('bestille');

    const isEmergency =
      lower.includes('akut') ||
      lower.includes('vandskade') ||
      lower.includes('oversvømmelse') ||
      lower.includes('emergency');

    const updateNote = `[WhatsApp - ${new Date().toLocaleTimeString()}]: "${messageText}"`;

    const isEnglish =
      tenant.default_language === 'en-US' ||
      lower.includes('call') ||
      lower.includes('please') ||
      lower.includes('emergency') ||
      lower.includes('order') ||
      lower.includes('book') ||
      lower.includes('hello') ||
      lower.includes('hi');
    const detectedLang = isEnglish ? 'en' : 'da';

    if (existingContact) {
      contactId = existingContact.id;
      const combinedMemory = existingContact.shared_memory_summary
        ? `${existingContact.shared_memory_summary}\n${updateNote}`
        : updateNote;

      let newStage = existingContact.pipeline_stage;
      if (isEmergency) newStage = 'dire_escalated';
      else if (wantsCall && newStage === 'new_lead') newStage = 'contacted';

      await supabaseAdmin
        .from('contacts')
        .update({
          shared_memory_summary: combinedMemory,
          pipeline_stage: newStage,
          lead_score: isEmergency ? 95 : Math.max(existingContact.lead_score, 70),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingContact.id);
    } else {
      const { data: newContact, error: insertErr } = await supabaseAdmin
        .from('contacts')
        .insert({
          tenant_id: tenant.id,
          phone_number: senderNumber,
          full_name: contactProfile,
          preferred_channel: 'whatsapp',
          preferred_language: detectedLang,
          lead_score: isEmergency ? 95 : 65,
          estimated_value_dkk: isEmergency ? 14500 : 3500,
          pipeline_stage: isEmergency ? 'dire_escalated' : 'contacted',
          shared_memory_summary: updateNote,
          sentiment_score: isEmergency ? 3.0 : 8.0,
        })
        .select()
        .single();

      if (insertErr || !newContact) {
        throw new Error(insertErr?.message || 'Failed to create contact from WhatsApp message');
      }
      contactId = newContact.id;
    }

    // 3. Log Inbound Message
    await Promise.all([
      supabaseAdmin.from('omnichannel_messages').insert({
        tenant_id: tenant.id,
        contact_id: contactId,
        channel: 'whatsapp',
        direction: 'inbound',
        content: messageText,
        metadata: { raw_wa_id: messageItem.id },
      }),
      supabaseAdmin.from('messages').insert({
        tenant_id: tenant.id,
        contact_id: contactId,
        channel: 'whatsapp',
        sender: 'customer',
        content: messageText,
        metadata: { raw_wa_id: messageItem.id },
      }),
    ]);

    // 4. Generate AI WhatsApp Auto-Reply with 1-Tap Instant Call Magic Link
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://nordic-omni.io';
    const instantCallUrl = `${baseUrl}/call/${contactId}`;

    let replyText = '';
    if (isEnglish) {
      if (wantsCall) {
        replyText = `Hi ${contactProfile}! I'd be glad to connect right now. Tap this instant 1-click call link to speak directly with our AI voice receptionist: ${instantCallUrl} or call our direct line at ${tenant.flynumber_did || '+4570201122'}.`;
      } else if (isEmergency) {
        replyText = `🚨 EMERGENCY ALERT: We received your urgent request. Our on-duty specialist has been alerted. Tap here to speak with us immediately: ${instantCallUrl}`;
      } else {
        replyText = `Hi ${contactProfile}, thank you for reaching out to ${tenant.name}. Our AI assistant is processing your request. For an instant answer or to book directly, call here: ${instantCallUrl}`;
      }
    } else {
      if (wantsCall) {
        replyText = `Hej ${contactProfile}! Jeg ringer dig gerne op med det samme. Tryk på dette 1-klik opkaldslink for direkte forbindelse over telefon/browser: ${instantCallUrl} eller ring på ${tenant.flynumber_did || '+4570201122'}.`;
      } else if (isEmergency) {
        replyText = `🚨 AKUT MELDING: Vi har modtaget din besked om vandskade/akut sag. Vores vagthold er underrettet. Tryk her for direkte opkald til vagten: ${instantCallUrl}`;
      } else {
        replyText = `Hej ${contactProfile}, tak for din besked til ${tenant.name}. Vores AI-assistent behandler din henvendelse. Hvis du har brug for et hurtigt svar eller vil booke en tid, kan du ringe direkte her: ${instantCallUrl}`;
      }
    }

    // Record Outbound Reply
    await Promise.all([
      supabaseAdmin.from('omnichannel_messages').insert({
        tenant_id: tenant.id,
        contact_id: contactId,
        channel: 'whatsapp',
        direction: 'outbound',
        content: replyText,
        metadata: { sent_by_ai: true, magic_call_link: instantCallUrl },
      }),
      supabaseAdmin.from('messages').insert({
        tenant_id: tenant.id,
        contact_id: contactId,
        channel: 'whatsapp',
        sender: 'ai',
        content: replyText,
        metadata: { sent_by_ai: true, magic_call_link: instantCallUrl },
      }),
    ]);

    // 5. Broadcast Realtime UI Command Event to dashboard
    await supabaseAdmin.from('ui_command_events').insert({
      tenant_id: tenant.id,
      command_type: 'OPEN_CONTACT_DRAWER',
      payload: { contactId, senderNumber, messageText },
    });

    return NextResponse.json({ success: true, status: 'EVENT_PROCESSED', contactId });
  } catch (error: any) {
    console.error('Meta webhook error:', error);
    return NextResponse.json(
      { error: 'Internal Meta webhook error', message: error?.message || 'Unknown' },
      { status: 500 }
    );
  }
}
