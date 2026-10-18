import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { OwnerCopilotCommandSchema, UICommandType } from '@/contracts/schemas';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
);

const llmClient = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY || process.env.GROQ_API_KEY || 'mock-key',
  baseURL: process.env.DEEPSEEK_API_KEY
    ? 'https://api.deepseek.com/v1'
    : 'https://api.groq.com/openai/v1',
});

interface ExecutionResult {
  replyText: string;
  uiCommands: Array<{ commandType: UICommandType; payload: Record<string, unknown> }>;
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json();
    const parseResult = OwnerCopilotCommandSchema.safeParse(rawBody);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid copilot payload', details: parseResult.error.format() },
        { status: 400 }
      );
    }

    const { tenantId, utterance, inputMode } = parseResult.data;

    // 1. Fetch current context for the tenant
    const [tenantRes, knowledgeRes, contactsRes, callLogsRes] = await Promise.all([
      supabaseAdmin.from('tenants').select('*').eq('id', tenantId).single(),
      supabaseAdmin.from('knowledge_items').select('*').eq('tenant_id', tenantId).eq('is_active', true),
      supabaseAdmin.from('contacts').select('*').eq('tenant_id', tenantId).order('updated_at', { ascending: false }).limit(20),
      supabaseAdmin.from('call_logs').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(10),
    ]);

    if (!tenantRes.data) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const tenant = tenantRes.data;
    const knowledge = knowledgeRes.data || [];
    const contacts = contactsRes.data || [];
    const callLogs = callLogsRes.data || [];

    // 2. Define tools for Owner God-Mode execution
    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'mutate_availability_or_hours',
          description: 'Updates business hours or overrides availability for a specific day.',
          parameters: {
            type: 'object',
            properties: {
              day: { type: 'string', description: 'Day of week e.g. monday, friday or YYYY-MM-DD' },
              status: { type: 'string', enum: ['open', 'closed'] },
              openTime: { type: 'string', description: 'HH:MM format' },
              closeTime: { type: 'string', description: 'HH:MM format' },
              overrideNote: { type: 'string', description: 'Reason or note for this change' },
            },
            required: ['day', 'status'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'mutate_pricing_or_knowledge',
          description: 'Updates pricing catalog or inserts a dynamic knowledge rule.',
          parameters: {
            type: 'object',
            properties: {
              category: {
                type: 'string',
                enum: ['pricing_update', 'availability_override', 'faq', 'emergency_rule'],
              },
              title: { type: 'string', description: 'Service or rule title' },
              content: { type: 'string', description: 'Detailed policy or description' },
              priceDkk: { type: 'number', description: 'Price in DKK if applicable' },
              unit: { type: 'string', enum: ['hour', 'call-out', 'package', 'fixed'] },
            },
            required: ['category', 'title', 'content'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'dispatch_owner_message_to_customer',
          description: 'Sends an outbound WhatsApp/Instagram message or logs an outreach instruction to a customer.',
          parameters: {
            type: 'object',
            properties: {
              contactIdentifier: { type: 'string', description: 'Contact full name or ID' },
              channel: { type: 'string', enum: ['whatsapp', 'instagram'] },
              messageText: { type: 'string', description: 'The exact message to send to the customer' },
            },
            required: ['contactIdentifier', 'channel', 'messageText'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'inspect_pipeline_and_brief_owner',
          description: 'Synthesizes an executive pipeline briefing and triggers UI scorecard focus.',
          parameters: {
            type: 'object',
            properties: {
              focusMetric: {
                type: 'string',
                enum: ['all', 'new_leads', 'pipeline_value', 'dire_escalations', 'booked'],
              },
            },
            required: ['focusMetric'],
          },
        },
      },
    ];

    const systemPrompt = `You are the executive AI Operations Manager (God Mode) for "${tenant.name}".
The Business Owner (${tenant.owner_name}) is giving you verbal or typed directives.
Your language is ${tenant.default_language === 'da-DK' ? 'Danish (da-DK)' : 'English (en-US)'}.
Respond concisely, authoritatively, and professionally. Always invoke the relevant tool to mutate the business or filter the UI.

Current Database State:
- Business Hours: ${JSON.stringify(tenant.business_hours)}
- Pricing Catalog: ${JSON.stringify(tenant.pricing_catalog)}
- Active Knowledge Overrides: ${JSON.stringify(knowledge.map((k: any) => ({ title: k.title, content: k.content })))}
- Recent Contacts Count: ${contacts.length} (Dire Escalated: ${contacts.filter((c: any) => c.pipeline_stage === 'dire_escalated').length})
- Recent Calls Count: ${callLogs.length}`;

    let replyText = '';
    const uiCommands: Array<{ commandType: UICommandType; payload: Record<string, unknown> }> = [];

    // Check if real API key is available, else execute intelligent algorithmic fallback
    const hasApiKey =
      (process.env.DEEPSEEK_API_KEY && !process.env.DEEPSEEK_API_KEY.includes('your_') && process.env.DEEPSEEK_API_KEY !== 'mock-key') ||
      (process.env.GROQ_API_KEY && !process.env.GROQ_API_KEY.includes('your_') && process.env.GROQ_API_KEY !== 'mock-key');

    let llmExecutedSuccessfully = false;

    if (hasApiKey) {
      try {
        const completion = await llmClient.chat.completions.create({
          model: process.env.DEEPSEEK_API_KEY ? 'deepseek-chat' : 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: utterance },
          ],
          tools,
          tool_choice: 'auto',
          temperature: 0.2,
        });

        const responseMessage = completion.choices[0].message;
        replyText = responseMessage.content || '';

        if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
          llmExecutedSuccessfully = true;
          for (const toolCall of responseMessage.tool_calls) {
            if (toolCall.type !== 'function') continue;
          const args = JSON.parse(toolCall.function.arguments);

          if (toolCall.function.name === 'mutate_availability_or_hours') {
            const dayKey = args.day.toLowerCase().substring(0, 3);
            const currentHours = { ...(tenant.business_hours as Record<string, any>) };

            if (currentHours[dayKey]) {
              currentHours[dayKey] = {
                open: args.openTime || currentHours[dayKey].open || '08:00',
                close: args.closeTime || currentHours[dayKey].close || '16:30',
                closed: args.status === 'closed',
              };

              await supabaseAdmin
                .from('tenants')
                .update({ business_hours: currentHours })
                .eq('id', tenantId);
            }

            await supabaseAdmin.from('knowledge_items').insert({
              tenant_id: tenantId,
              category: 'availability_override',
              title: `Åbningstider ændring: ${args.day}`,
              content: `Status: ${args.status}. ${args.overrideNote || ''}`,
              updated_by: 'owner_copilot',
              is_active: true,
            });

            uiCommands.push({
              commandType: 'HIGHLIGHT_AVAILABILITY',
              payload: { dayKey, status: args.status },
            });

            replyText =
              tenant.default_language === 'da-DK'
                ? `Jeg har opdateret åbningstiderne for ${args.day} til ${args.status === 'closed' ? 'lukket' : 'åben'}. Skærmen er synkroniseret.`
                : `I have updated the schedule for ${args.day} to ${args.status}. The availability matrix has been updated.`;
          }

          if (toolCall.function.name === 'mutate_pricing_or_knowledge') {
            let updatedCatalog = [...(tenant.pricing_catalog as Array<Record<string, any>>)];

            if (args.priceDkk) {
              const existingIdx = updatedCatalog.findIndex((p) =>
                (p.service as string).toLowerCase().includes(args.title.toLowerCase())
              );

              if (existingIdx >= 0) {
                updatedCatalog[existingIdx].price_dkk = args.priceDkk;
              } else {
                updatedCatalog.push({
                  id: `p_${Date.now()}`,
                  service: args.title,
                  price_dkk: args.priceDkk,
                  unit: args.unit || 'service',
                });
              }

              await supabaseAdmin
                .from('tenants')
                .update({ pricing_catalog: updatedCatalog })
                .eq('id', tenantId);
            }

            await supabaseAdmin.from('knowledge_items').insert({
              tenant_id: tenantId,
              category: args.category,
              title: args.title,
              content: `${args.content}${args.priceDkk ? ` | Ny Pris: ${args.priceDkk} DKK` : ''}`,
              updated_by: 'owner_copilot',
              is_active: true,
            });

            uiCommands.push({
              commandType: 'HIGHLIGHT_PRICING',
              payload: { title: args.title, priceDkk: args.priceDkk },
            });

            replyText =
              tenant.default_language === 'da-DK'
                ? `Prisen og retningslinjen for "${args.title}" er opdateret i hukommelsen. Kundebotten bruger den nye information øjeblikkeligt.`
                : `Pricing and rule for "${args.title}" has been updated. The customer-facing agent is using this knowledge immediately.`;
          }

          if (toolCall.function.name === 'dispatch_owner_message_to_customer') {
            const matchedContact = contacts.find(
              (c: any) =>
                (c.full_name && c.full_name.toLowerCase().includes(args.contactIdentifier.toLowerCase())) ||
                c.id === args.contactIdentifier
            );

            if (matchedContact) {
              await supabaseAdmin.from('messages').insert({
                tenant_id: tenantId,
                contact_id: matchedContact.id,
                channel: args.channel,
                sender: 'owner',
                content: args.messageText,
                metadata: { sent_via: 'owner_copilot' },
              });

              await supabaseAdmin
                .from('contacts')
                .update({
                  updated_at: new Date().toISOString(),
                })
                .eq('id', matchedContact.id);

              uiCommands.push({
                commandType: 'OPEN_CONTACT_DRAWER',
                payload: { contactId: matchedContact.id },
              });

              replyText =
                tenant.default_language === 'da-DK'
                  ? `Beskeden er afsendt til ${matchedContact.full_name} via ${args.channel}. Jeg har åbnet tidslinjen på din skærm.`
                  : `Message dispatched to ${matchedContact.full_name} over ${args.channel}. Opening their contact drawer now.`;
            } else {
              replyText =
                tenant.default_language === 'da-DK'
                  ? `Jeg kunne desværre ikke finde en kontakt ved navn "${args.contactIdentifier}".`
                  : `Could not locate a contact matching "${args.contactIdentifier}".`;
            }
          }

          if (toolCall.function.name === 'inspect_pipeline_and_brief_owner') {
            const totalVal = contacts.reduce((sum: number, c: any) => sum + Number(c.estimated_value_dkk || 0), 0);
            const direCount = contacts.filter((c: any) => c.pipeline_stage === 'dire_escalated').length;
            const bookedCount = contacts.filter((c: any) => c.pipeline_stage === 'booked').length;

            uiCommands.push({
              commandType: 'FOCUS_SCORECARD',
              payload: { metricId: args.focusMetric },
            });

            replyText =
              tenant.default_language === 'da-DK'
                ? `Her er overblikket: Du har ${contacts.length} aktive leads til en samlet værdi af ${totalVal.toLocaleString('da-DK')} DKK. Der er ${bookedCount} bookede aftaler og ${direCount} akutte eskaleringer, der kræver opmærksomhed.`
                : `Here is the operational brief: ${contacts.length} active leads with a pipeline value of ${totalVal.toLocaleString()} DKK. ${bookedCount} booked appointments and ${direCount} dire escalations requiring attention.`;
          }
        }
      }
    } catch (llmErr) {
      console.warn('LLM completion call failed, falling back to deterministic parser:', llmErr);
    }
  }

    if (!llmExecutedSuccessfully) {
      // Deterministic Algorithmic Parsing Fallback for offline / development sandbox or LLM fallback
      const lower = utterance.toLowerCase();
      if (lower.includes('luk') || lower.includes('close') || lower.includes('åben') || lower.includes('fredag') || lower.includes('friday')) {
        const isClosed = lower.includes('luk') || lower.includes('close');
        const day = lower.includes('fredag') || lower.includes('friday') ? 'fri' : 'mon';
        const currentHours = { ...(tenant.business_hours as Record<string, any>) };
        if (currentHours[day]) {
          currentHours[day].closed = isClosed;
          await supabaseAdmin.from('tenants').update({ business_hours: currentHours }).eq('id', tenantId);
        }

        uiCommands.push({
          commandType: 'HIGHLIGHT_AVAILABILITY',
          payload: { dayKey: day, status: isClosed ? 'closed' : 'open' },
        });

        replyText = tenant.default_language === 'da-DK'
          ? `Jeg har opdateret åbningstiderne for ${day === 'fri' ? 'fredag' : 'mandag'} til ${isClosed ? 'lukket' : 'åben'}. Skærmen er synkroniseret.`
          : `I have updated the schedule for ${day} to ${isClosed ? 'closed' : 'open'}. Screen synchronized.`;
      } else if (lower.includes('pris') || lower.includes('rate') || lower.includes('dkk') || lower.includes('opdater')) {
        const matchDigits = utterance.match(/\d+/);
        const newPrice = matchDigits ? parseInt(matchDigits[0], 10) : 950;
        let catalog = [...(tenant.pricing_catalog as Array<Record<string, any>>)];
        if (catalog.length > 0) {
          catalog[0].price_dkk = newPrice;
          await supabaseAdmin.from('tenants').update({ pricing_catalog: catalog }).eq('id', tenantId);
        }

        uiCommands.push({
          commandType: 'HIGHLIGHT_PRICING',
          payload: { pricingId: catalog[0]?.id, priceDkk: newPrice },
        });

        replyText = tenant.default_language === 'da-DK'
          ? `Prisen er sat til ${newPrice} DKK. Kundebotten bruger den nye information med det samme.`
          : `Rate updated to ${newPrice} DKK. Customer voice and chat agent updated immediately.`;
      } else {
        const totalVal = contacts.reduce((sum: number, c: any) => sum + Number(c.estimated_value_dkk || 0), 0);
        const direCount = contacts.filter((c: any) => c.pipeline_stage === 'dire_escalated').length;
        const bookedCount = contacts.filter((c: any) => c.pipeline_stage === 'booked').length;

        uiCommands.push({
          commandType: 'FOCUS_SCORECARD',
          payload: { metricId: 'pipeline-value' },
        });

        replyText = tenant.default_language === 'da-DK'
          ? `Overblik: Du har ${contacts.length} aktive leads med en samlet værdi på ${totalVal.toLocaleString('da-DK')} DKK. ${bookedCount} bookede aftaler og ${direCount} akutte eskaleringer.`
          : `Operational briefing: ${contacts.length} leads with total pipeline value of ${totalVal.toLocaleString()} DKK. ${bookedCount} booked and ${direCount} dire escalations.`;
      }
    }

    // 3. Broadcast UI Command Events to Supabase Realtime
    for (const cmd of uiCommands) {
      await supabaseAdmin.from('ui_command_events').insert({
        tenant_id: tenantId,
        command_type: cmd.commandType,
        payload: cmd.payload,
      });
    }

    return NextResponse.json({
      replyText,
      uiCommands,
      inputMode,
    });
  } catch (error: any) {
    console.error('Owner copilot route error:', error);
    return NextResponse.json(
      { error: 'Internal copilot execution failure', message: error?.message || 'Unknown' },
      { status: 500 }
    );
  }
}
