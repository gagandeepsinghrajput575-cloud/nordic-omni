'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAgency } from '@/lib/auth/guard';
import { withUser } from '@/lib/db/client';

/**
 * Agency-only mutation of tenant AI behaviour.
 *
 * Defence in depth, in this order:
 *   1. requireAgency()      -> application layer
 *   2. Zod parse            -> input validation
 *   3. RLS on tenant_agent_config -> only is_agency() may write (see 0001_baseline.sql)
 *
 * Before writing, the previous configuration is snapshotted into
 * agent_config_history so a bad prompt can be rolled back.
 */

const UpdateConfigSchema = z.object({
  tenantId: z.string().uuid(),
  customer_system_prompt: z.string().min(20, 'Prompt must be at least 20 characters').max(8000),
  copilot_system_prompt: z.string().min(20, 'Prompt must be at least 20 characters').max(8000),
  greeting_script: z.string().max(500).optional(),
  voice_id: z.string().max(100).optional(),
});

export interface ActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

export async function updateAgentConfig(formData: FormData): Promise<ActionResult> {
  const session = await requireAgency();

  const parsed = UpdateConfigSchema.safeParse({
    tenantId: formData.get('tenantId'),
    customer_system_prompt: formData.get('customer_system_prompt'),
    copilot_system_prompt: formData.get('copilot_system_prompt'),
    greeting_script: formData.get('greeting_script') || undefined,
    voice_id: formData.get('voice_id') || undefined,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }

  const { tenantId, customer_system_prompt, copilot_system_prompt, greeting_script, voice_id } = parsed.data;

  try {
    await withUser(session.userId, async (tx) => {
      // 1. Snapshot the current version.
      await tx`
        insert into agent_config_history
          (tenant_id, customer_system_prompt, copilot_system_prompt,
           greeting_script, escalation_policy, voice_id, changed_by)
        select tenant_id, customer_system_prompt, copilot_system_prompt,
               greeting_script, escalation_policy, voice_id, ${session.userId}
        from tenant_agent_config
        where tenant_id = ${tenantId}
      `;

      // 2. Apply the new version.
      const updated = await tx`
        update tenant_agent_config
           set customer_system_prompt = ${customer_system_prompt},
               copilot_system_prompt  = ${copilot_system_prompt},
               greeting_script        = ${greeting_script ?? null},
               voice_id               = ${voice_id ?? null},
               updated_by             = ${session.userId}
         where tenant_id = ${tenantId}
        returning tenant_id
      `;

      if (updated.length === 0) {
        throw new Error('No agent config found for this tenant');
      }
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Update failed',
    };
  }

  revalidatePath(`/agency/clients/${tenantId}`);
  return { ok: true, message: 'Agent behaviour updated. The next call uses it.' };
}

const RestoreSchema = z.object({
  tenantId: z.string().uuid(),
  historyId: z.string().uuid(),
});

export async function restoreAgentConfig(formData: FormData): Promise<ActionResult> {
  const session = await requireAgency();

  const parsed = RestoreSchema.safeParse({
    tenantId: formData.get('tenantId'),
    historyId: formData.get('historyId'),
  });
  if (!parsed.success) return { ok: false, error: 'Invalid rollback request' };

  const { tenantId, historyId } = parsed.data;

  try {
    await withUser(session.userId, async (tx) => {
      // Snapshot current before rolling back, so rollback is itself reversible.
      await tx`
        insert into agent_config_history
          (tenant_id, customer_system_prompt, copilot_system_prompt,
           greeting_script, escalation_policy, voice_id, changed_by)
        select tenant_id, customer_system_prompt, copilot_system_prompt,
               greeting_script, escalation_policy, voice_id, ${session.userId}
        from tenant_agent_config
        where tenant_id = ${tenantId}
      `;

      const restored = await tx`
        update tenant_agent_config c
           set customer_system_prompt = h.customer_system_prompt,
               copilot_system_prompt  = h.copilot_system_prompt,
               greeting_script        = h.greeting_script,
               updated_by             = ${session.userId}
          from agent_config_history h
         where h.id = ${historyId}
           and h.tenant_id = ${tenantId}
           and c.tenant_id = ${tenantId}
        returning c.tenant_id
      `;

      if (restored.length === 0) throw new Error('History entry not found');
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Rollback failed' };
  }

  revalidatePath(`/agency/clients/${tenantId}`);
  return { ok: true, message: 'Previous prompt restored.' };
}

/** Void-returning wrapper so it can be used directly as a <form action={...}>. */
export async function restoreAgentConfigForm(formData: FormData): Promise<void> {
  await restoreAgentConfig(formData);
}

export interface GenerateAgentInput {
  companyName: string;
  industry: string;
  language: 'da' | 'en';
  tone: 'professional' | 'warm' | 'urgent_dispatcher';
  keyServices?: string;
}

export async function generateAgentConfigAction(input: GenerateAgentInput): Promise<{
  ok: boolean;
  error?: string;
  data?: {
    customer_system_prompt: string;
    copilot_system_prompt: string;
    greeting_script: string;
    voice_id: string;
  };
}> {
  await requireAgency();

  const isDanish = input.language === 'da';
  const company = input.companyName.trim() || 'Virksomheden';
  const industry = input.industry.trim() || (isDanish ? 'håndværk & service' : 'general services');
  const services = input.keyServices?.trim() || (isDanish ? 'Akut udrykning, rådgivning og serviceopgaver' : 'Emergency service, diagnostics, and general inquiries');
  const toneDesc = input.tone === 'urgent_dispatcher'
    ? (isDanish ? 'Rolig, hurtig og fokuseret på hurtig udrykning og sikkerhed.' : 'Calm, rapid, and focused on emergency dispatch and safety.')
    : input.tone === 'warm'
    ? (isDanish ? 'Imødekommende, empatisk og hjælpsom.' : 'Warm, empathetic, and attentive.')
    : (isDanish ? 'Professionel, høflig og præcis.' : 'Professional, polite, and precise.');

  const greeting = isDanish
    ? `Goddag, du har ringet til ${company}. Du taler med den automatiske telefonsvarer. Hvad kan jeg hjælpe dig med i dag?`
    : `Hello, thank you for calling ${company}. You are speaking with the AI receptionist. How can I help you today?`;

  const customerPrompt = isDanish
    ? `Du er den venlige og professionelle telefonreceptionist for ${company}, specialiseret i ${industry}.
Tone: ${toneDesc}

## FORMÅL
Besvar indgående kundeopkald, identificér kundens problem, svar på almindelige spørgsmål, og book en tid eller optag en besked til mester.

## TJENESTER OG SERVICES
${services}

## RETNINGSLINJER FOR SAMTALEN
- Tal naturligt og i korte sætninger (1-2 sætninger ad gangen), da samtalen foregår over telefonen.
- Spørg altid om kundens adresse og telefonnummer hvis de ønsker en aftale.
- Hvis kunden har en akut nødsituation (f.eks. oversvømmelse, sprængt rør, strømsvigt, eller akut tandpine), berolig kunden og overdrag straks sagen til vagthavende mester.
- Opfind aldrig priser eller garantier, der ikke er bekræftet.
- Vær altid høflig og repræsentér ${company} på bedste vis.`
    : `You are the friendly and professional phone receptionist for ${company}, specializing in ${industry}.
Tone: ${toneDesc}

## PURPOSE
Answer incoming customer calls, diagnose the customer's need, answer general questions, and arrange service or record a callback for the team.

## SERVICES OFFERED
${services}

## CONVERSATION GUIDELINES
- Speak naturally and in concise sentences (1-2 sentences at a time) suitable for phone telephony.
- Always ask for the caller's location and preferred contact number when booking.
- For emergency situations (flood, structural damage, gas leak, severe pain), immediately trigger emergency escalation to the on-call staff.
- Never invent prices, guarantees, or availability outside verified policies.
- Represent ${company} with maximum reliability and care.`;

  const copilotPrompt = isDanish
    ? `Du er den interne AI-assistent og co-pilot for ejeren af ${company}. Du opsummerer indgående kundeopkald, fremhæver akutte problemer, og hjælper med hurtig opfølgning på nye kundeemner.`
    : `You are the internal AI assistant and co-pilot for the owner of ${company}. You summarize incoming calls, highlight urgent issues, and draft rapid follow-up actions.`;

  const voiceId = isDanish ? 'azure:da-DK-ChristelNeural' : 'azure:en-US-JennyNeural';

  return {
    ok: true,
    data: {
      customer_system_prompt: customerPrompt,
      copilot_system_prompt: copilotPrompt,
      greeting_script: greeting,
      voice_id: voiceId,
    },
  };
}


