import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { LeadFormWebhookPayloadSchema } from '@/contracts/schemas';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
);

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json();
    const parseResult = LeadFormWebhookPayloadSchema.safeParse(rawBody);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid lead form payload', details: parseResult.error.format() },
        { status: 400 }
      );
    }

    const {
      tenantSlug,
      fullName,
      phoneNumber,
      email,
      channelPreference,
      instagramHandle,
      inquiryText,
      language,
    } = parseResult.data;

    // 1. Resolve Tenant by Slug
    const { data: tenant, error: tenantErr } = await supabaseAdmin
      .from('tenants')
      .select('*')
      .eq('slug', tenantSlug)
      .single();

    if (tenantErr || !tenant) {
      return NextResponse.json(
        { error: `Tenant with slug "${tenantSlug}" not found` },
        { status: 404 }
      );
    }

    // 2. Lead Scoring & Intent Evaluation
    const lowerText = inquiryText.toLowerCase();
    const isEmergency =
      lowerText.includes('akut') ||
      lowerText.includes('haste') ||
      lowerText.includes('vandskade') ||
      lowerText.includes('oversvømmelse') ||
      lowerText.includes('sprængt') ||
      lowerText.includes('emergency') ||
      lowerText.includes('urgent') ||
      lowerText.includes('flood') ||
      lowerText.includes('flooding') ||
      lowerText.includes('burst') ||
      lowerText.includes('leak') ||
      lowerText.includes('broken');

    const isHighValue =
      lowerText.includes('varmepumpe') ||
      lowerText.includes('komplet') ||
      lowerText.includes('invisalign') ||
      lowerText.includes('tagrens') ||
      lowerText.includes('renovering') ||
      lowerText.includes('heat pump') ||
      lowerText.includes('renovation') ||
      lowerText.includes('roof cleaning') ||
      lowerText.includes('implant') ||
      lowerText.includes('commercial');

    let leadScore = 50;
    let estimatedValueDkk = 2500;
    let pipelineStage = 'new_lead';

    if (isEmergency) {
      leadScore = 95;
      estimatedValueDkk = 14500;
      pipelineStage = 'dire_escalated';
    } else if (isHighValue) {
      leadScore = 80;
      estimatedValueDkk = 38000;
      pipelineStage = 'qualified';
    }

    // 3. Upsert Contact Record
    const sharedMemoryEntry = `[Lead Form Ingestion - ${new Date().toLocaleTimeString()}]: Indsendte forespørgsel: "${inquiryText}". Foretrækker ${channelPreference.toUpperCase()}.`;

    let contactId = '';
    const { data: existingContact } = await supabaseAdmin
      .from('contacts')
      .select('*')
      .eq('tenant_id', tenant.id)
      .eq('phone_number', phoneNumber)
      .maybeSingle();

    if (existingContact) {
      contactId = existingContact.id;
      const combinedSummary = existingContact.shared_memory_summary
        ? `${existingContact.shared_memory_summary}\n${sharedMemoryEntry}`
        : sharedMemoryEntry;

      await supabaseAdmin
        .from('contacts')
        .update({
          full_name: fullName || existingContact.full_name,
          email: email || existingContact.email,
          instagram_handle: instagramHandle || existingContact.instagram_handle,
          preferred_channel: channelPreference,
          preferred_language: language,
          lead_score: Math.max(existingContact.lead_score, leadScore),
          estimated_value_dkk: Math.max(existingContact.estimated_value_dkk, estimatedValueDkk),
          pipeline_stage: pipelineStage,
          shared_memory_summary: combinedSummary,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingContact.id);
    } else {
      const { data: newContact, error: insertErr } = await supabaseAdmin
        .from('contacts')
        .insert({
          tenant_id: tenant.id,
          phone_number: phoneNumber,
          email: email || null,
          full_name: fullName,
          instagram_handle: instagramHandle || null,
          preferred_channel: channelPreference,
          preferred_language: language,
          lead_score: leadScore,
          estimated_value_dkk: estimatedValueDkk,
          pipeline_stage: pipelineStage,
          shared_memory_summary: sharedMemoryEntry,
          sentiment_score: 7.5,
        })
        .select()
        .single();

      if (insertErr || !newContact) {
        throw new Error(insertErr?.message || 'Failed to insert contact');
      }
      contactId = newContact.id;
    }

    // 4. Log Inbound Form Message in Omnichannel Ledger
    await Promise.all([
      supabaseAdmin.from('omnichannel_messages').insert({
        tenant_id: tenant.id,
        contact_id: contactId,
        channel: 'lead_form',
        direction: 'inbound',
        content: inquiryText,
        metadata: { form_slug: tenantSlug, channel_pref: channelPreference },
      }),
      supabaseAdmin.from('messages').insert({
        tenant_id: tenant.id,
        contact_id: contactId,
        channel: 'lead_form',
        sender: 'customer',
        content: inquiryText,
        metadata: { form_slug: tenantSlug },
      }),
    ]);

    // 5. Fire Instant WhatsApp / Meta Contextual Reply with Magic Call Link ($0 WebRTC)
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://nordic-omni.io';
    const instantCallUrl = `${baseUrl}/call/${contactId}`;

    const autoReplyText =
      language === 'da'
        ? `Hej ${fullName}! Tak for din henvendelse til ${tenant.name}. Vi har modtaget din besked: "${inquiryText}". ` +
          `Hvis du vil tale direkte med vores AI-receptionist lige nu, kan du trykke her: ${instantCallUrl} ` +
          (tenant.flynumber_did ? `eller ringe på vores hovednummer ${tenant.flynumber_did}.` : '')
        : `Hi ${fullName}! Thank you for reaching out to ${tenant.name}. We received your inquiry: "${inquiryText}". ` +
          `You can speak with our AI agent immediately by tapping this instant call link: ${instantCallUrl} ` +
          (tenant.flynumber_did ? `or dial our direct line at ${tenant.flynumber_did}.` : '');

    // Record Outbound Auto-Reply
    await Promise.all([
      supabaseAdmin.from('omnichannel_messages').insert({
        tenant_id: tenant.id,
        contact_id: contactId,
        channel: channelPreference === 'instagram' ? 'instagram' : 'whatsapp',
        direction: 'outbound',
        content: autoReplyText,
        metadata: { sent_by_ai: true, magic_call_link: instantCallUrl },
      }),
      supabaseAdmin.from('messages').insert({
        tenant_id: tenant.id,
        contact_id: contactId,
        channel: channelPreference === 'instagram' ? 'instagram' : 'whatsapp',
        sender: 'ai',
        content: autoReplyText,
        metadata: { sent_by_ai: true, magic_call_link: instantCallUrl },
      }),
    ]);

    // 6. Emit Reactive UI Command Event so lead flies into view on Kanban & Scorecards
    await supabaseAdmin.from('ui_command_events').insert({
      tenant_id: tenant.id,
      command_type: 'PULSE_METRIC',
      payload: {
        metricId: 'inbound-leads',
        contactId,
        leadName: fullName,
        estimatedValueDkk,
      },
    });

    if (isEmergency) {
      await supabaseAdmin.from('ui_command_events').insert({
        tenant_id: tenant.id,
        command_type: 'TRIGGER_DIRE_MODAL',
        payload: {
          contactId,
          customerName: fullName,
          phoneNumber,
          reason: 'high_value_emergency',
          estimatedValueDkk,
          aiBriefing: `Akut lead modtaget via formular: "${inquiryText}"`,
        },
      });
    }

    return NextResponse.json({
      success: true,
      contactId,
      instantCallUrl,
      leadScore,
      pipelineStage,
      autoReplySent: true,
    });
  } catch (error: any) {
    console.error('Lead form webhook error:', error);
    return NextResponse.json(
      { error: 'Internal lead form ingestion failure', message: error?.message || 'Unknown' },
      { status: 500 }
    );
  }
}
