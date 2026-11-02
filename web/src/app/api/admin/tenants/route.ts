import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ProvisionTenantPayloadSchema } from '@/contracts/schemas';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
);

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json();
    const parseResult = ProvisionTenantPayloadSchema.safeParse(rawBody);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid tenant provisioning payload', details: parseResult.error.format() },
        { status: 400 }
      );
    }

    const payload = parseResult.data;
    const tenantId = crypto.randomUUID();

    // Ensure unique slug
    let finalSlug = payload.slug.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const { data: existingSlug } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .eq('slug', finalSlug)
      .maybeSingle();

    if (existingSlug) {
      finalSlug = `${finalSlug}-${Math.floor(100 + Math.random() * 900)}`;
    }

    // Insert Tenant Record
    const { data: tenant, error: tenantErr } = await supabaseAdmin
      .from('tenants')
      .insert({
        id: tenantId,
        name: payload.name,
        slug: finalSlug,
        owner_name: payload.owner_name,
        owner_phone: payload.owner_phone,
        owner_email: payload.owner_email,
        owner_pin: '1234',
        default_language: payload.default_language,
        telephony_mode: payload.telephony_mode,
        flynumber_did: payload.flynumber_did || null,
        client_passkey: payload.client_passkey,
        customer_system_prompt: payload.customer_system_prompt,
        copilot_system_prompt: payload.copilot_system_prompt,
        active_broadcast_message: payload.active_broadcast_message || null,
        business_hours: payload.business_hours,
        pricing_catalog: payload.pricing_catalog,
      })
      .select()
      .single();

    if (tenantErr || !tenant) {
      throw new Error(tenantErr?.message || 'Database error provisioning tenant');
    }

    // Insert starter knowledge items if any
    if (payload.knowledge_items && payload.knowledge_items.length > 0) {
      const knowledgeRows = payload.knowledge_items.map((k) => ({
        tenant_id: tenantId,
        category: k.category,
        title: k.title,
        content: k.content,
        updated_by: 'deepseek_wizard',
        is_active: true,
      }));

      await supabaseAdmin.from('knowledge_items').insert(knowledgeRows);
    }

    // Seed a welcome contact so the Kanban is not completely blank
    const welcomeContactId = crypto.randomUUID();
    const isDanish = payload.default_language.startsWith('da');
    await supabaseAdmin.from('contacts').insert({
      id: welcomeContactId,
      tenant_id: tenantId,
      full_name: isDanish ? 'Mads Mikkelsen (Test Lead)' : 'Emma Watson (Test Lead)',
      phone_number: isDanish ? '+4599887766' : '+447911000111',
      preferred_channel: 'whatsapp',
      preferred_language: isDanish ? 'da' : 'en',
      lead_score: 75,
      estimated_value_dkk: 3500,
      pipeline_stage: 'new_lead',
      ai_auto_reply_enabled: true,
      shared_memory_summary: isDanish
        ? 'Test-lead automatisk oprettet ved workspace deployment. Klar til AI opkald eller WhatsApp.'
        : 'Test lead created automatically on workspace deployment. Ready for AI call or WhatsApp message.',
    });

    return NextResponse.json({
      success: true,
      tenant,
      clientPasskey: payload.client_passkey,
      portalUrl: `/portal/${finalSlug}`,
    });
  } catch (error: any) {
    console.error('Tenant provisioning route error:', error);
    return NextResponse.json(
      { error: 'Tenant provisioning failed', message: error?.message || 'Unknown' },
      { status: 500 }
    );
  }
}
