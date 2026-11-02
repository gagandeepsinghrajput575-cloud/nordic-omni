import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { ProvisionWizardRequestSchema, ProvisionTenantPayloadSchema } from '@/contracts/schemas';

const llmClient = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY || process.env.GROQ_API_KEY || 'mock-key',
  baseURL: process.env.DEEPSEEK_API_KEY
    ? 'https://api.deepseek.com/v1'
    : 'https://api.groq.com/openai/v1',
});

const SYSTEM_INTERVIEW_PROMPT = `You are the DeepSeek Client Onboarding Architect for the Nordic-Omni Voice & Omnichannel Platform.
Your mission is to interview an agency operator or business owner to extract all details needed to spin up a fully autonomous AI voice receptionist, chatbot, and CRM workspace for a local service business (trades, dental, clinics, HVAC, etc.).

A complete profile requires:
1. Business Name & Industry (e.g. "Aarhus VVS", "Copenhagen Dental")
2. Owner Name, Phone Number (preferably E.164 e.g. +45...), and Email
3. Operating Language: Danish (da-DK) or English (en-US)
4. Standard Business Hours (Mon–Sun opening/closing times or days closed)
5. Core Services & Pricing Catalog (at least 2–4 services with prices in DKK or EUR)
6. Emergency / Dire Escalation Policy (what counts as an emergency, emergency fee, who gets alerted)
7. Preferred Tone of Voice (e.g. calm authoritative, warm & friendly, formal medical)

Instructions:
- Analyze the user's input and prior conversation history.
- If essential information is missing, respond conversationally with 1–3 precise, concise questions.
- If sufficient information has been collected, present an organized summary and state: "I have gathered enough details to build the AI agent and CRM. Click 'Generate Profile' or let me know if you want to tweak anything."
- Set "readyToGenerate": true when the fundamental fields (Name, Owner, Services/Pricing, Language) are identified.
- Output JSON format:
{
  "reply": "Your conversational message to the user with questions or summary",
  "readyToGenerate": boolean,
  "missingFields": ["list", "of", "missing", "fields"]
}`;

const SYSTEM_GENERATE_PROMPT = `You are the DeepSeek Master AI Architect.
Given the accumulated conversation and notes about a business, generate the COMPLETE, structured JSON payload to deploy a new tenant workspace with a custom AI voice receptionist, chatbot, and CRM.

Requirements:
- "slug": URL-safe identifier (e.g., "aarhus-vvs", "viking-roofing")
- "client_passkey": Generate a secure passkey formatted like "CPK-{SLUG_UPPER}-{4_RANDOM_DIGITS}-SEC"
- "customer_system_prompt": A thorough, production-grade prompt for the LiveKit Voice Receptionist. Must enforce language (Danish or English), conversational brevity for phone calls, pricing quoting from the catalog, and mandatory invocation of dire escalation for true emergencies.
- "copilot_system_prompt": A production-grade prompt for the Owner's operations co-pilot (God Mode).
- "business_hours": Mon-Sun JSON object with open, close (HH:MM), and closed (boolean).
- "pricing_catalog": Array of objects: [{"id": "p1", "service": "...", "price_dkk": number, "unit": "hour"|"call-out"|"package"|"fixed"}]
- "knowledge_items": Array of 2-3 starter knowledge rules [{"category": "policy"|"faq", "title": "...", "content": "..."}]

Return strictly valid JSON matching this schema:
{
  "name": string,
  "slug": string,
  "owner_name": string,
  "owner_phone": string,
  "owner_email": string,
  "default_language": "da-DK" | "en-US",
  "telephony_mode": "zero_cost_webrtc" | "paid_sip_trunk",
  "flynumber_did": string | null,
  "client_passkey": string,
  "customer_system_prompt": string,
  "copilot_system_prompt": string,
  "active_broadcast_message": string | null,
  "business_hours": {
    "mon": {"open": "08:00", "close": "16:30", "closed": false},
    "tue": {"open": "08:00", "close": "16:30", "closed": false},
    "wed": {"open": "08:00", "close": "16:30", "closed": false},
    "thu": {"open": "08:00", "close": "16:30", "closed": false},
    "fri": {"open": "08:00", "close": "15:00", "closed": false},
    "sat": {"open": "09:00", "close": "14:00", "closed": true},
    "sun": {"open": "00:00", "close": "00:00", "closed": true}
  },
  "pricing_catalog": [
    {"id": "p1", "service": "Standard Service", "price_dkk": 850, "unit": "hour"},
    {"id": "p2", "service": "Emergency Call-out", "price_dkk": 2200, "unit": "call-out"}
  ],
  "knowledge_items": [
    {"category": "faq", "title": "Payment", "content": "Payments are invoiced or taken on-site directly by the technician."}
  ]
}`;

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json();
    const parseResult = ProvisionWizardRequestSchema.safeParse(rawBody);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid wizard payload', details: parseResult.error.format() },
        { status: 400 }
      );
    }

    const { mode, notes, history } = parseResult.data;
    const hasApiKey = Boolean(process.env.DEEPSEEK_API_KEY || process.env.GROQ_API_KEY);

    // MODE 1: INTERVIEW & REFINEMENT
    if (mode === 'interview') {
      if (hasApiKey) {
        try {
          const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            { role: 'system', content: SYSTEM_INTERVIEW_PROMPT },
            ...history.map((h) => ({ role: h.role, content: h.content })),
            { role: 'user', content: notes },
          ];

          const completion = await llmClient.chat.completions.create({
            model: process.env.DEEPSEEK_API_KEY ? 'deepseek-chat' : 'llama-3.3-70b-versatile',
            messages,
            response_format: { type: 'json_object' },
            temperature: 0.3,
          });

          const rawContent = completion.choices[0].message.content || '{}';
          const parsed = JSON.parse(rawContent);

          return NextResponse.json({
            success: true,
            reply: parsed.reply || "I've reviewed your notes. Could you clarify the business hours and primary services?",
            readyToGenerate: Boolean(parsed.readyToGenerate),
            missingFields: parsed.missingFields || [],
          });
        } catch (llmErr) {
          console.warn('DeepSeek interview call failed, falling back to algorithmic analyzer:', llmErr);
        }
      }

      // Algorithmic Sandbox Fallback
      const lower = notes.toLowerCase();
      const hasPhone = /(\+45|\+44|\+1|\d{8})/.test(notes);
      const hasPrices = /\d+\s*(kr|dkk|\$|€|euro)/i.test(notes) || /\d{3,}/.test(notes);
      const isEnglish = lower.includes('english') || lower.includes('expat') || lower.includes('dental') || lower.includes('clinic');

      const missing: string[] = [];
      if (!hasPhone) missing.push('Owner telephone number');
      if (!hasPrices) missing.push('Core services & pricing catalog');
      if (!lower.includes('hour') && !lower.includes('åben') && !lower.includes('open')) missing.push('Operating hours');

      const readyToGenerate = missing.length <= 1;

      let reply = '';
      if (isEnglish) {
        reply = readyToGenerate
          ? `I have extracted the core profile for your business! I will set up the bilingual AI voice receptionist, WhatsApp ingestion, and live Kanban CRM. Click 'Generate Profile' to preview the configuration.`
          : `Thanks for the details! To ensure your AI voice receptionist quotes customers accurately, could you clarify: ${missing.join(', ')}?`;
      } else {
        reply = readyToGenerate
          ? `Jeg har registreret de vigtigste oplysninger! Jeg opsætter den autoriserede AI-receptionist, WhatsApp-svarende og Kanban-pipelinen. Klik på 'Generer Profil' for at se det fulde udkast.`
          : `Tak for oplysningerne! For at stemme-assistenten svarer præcist, mangler vi blot: ${missing.join(', ')}?`;
      }

      return NextResponse.json({
        success: true,
        reply,
        readyToGenerate,
        missingFields: missing,
      });
    }

    // MODE 2: GENERATE FULL PROFILE PAYLOAD
    if (mode === 'generate') {
      if (hasApiKey) {
        try {
          const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            { role: 'system', content: SYSTEM_GENERATE_PROMPT },
            ...history.map((h) => ({ role: h.role, content: h.content })),
            { role: 'user', content: `Generate the final tenant payload based on this context: ${notes}` },
          ];

          const completion = await llmClient.chat.completions.create({
            model: process.env.DEEPSEEK_API_KEY ? 'deepseek-chat' : 'llama-3.3-70b-versatile',
            messages,
            response_format: { type: 'json_object' },
            temperature: 0.2,
          });

          const rawContent = completion.choices[0].message.content || '{}';
          const generatedPayload = JSON.parse(rawContent);

          const validation = ProvisionTenantPayloadSchema.safeParse(generatedPayload);
          if (validation.success) {
            return NextResponse.json({
              success: true,
              tenantPayload: validation.data,
            });
          }
        } catch (genErr) {
          console.warn('DeepSeek generation failed, falling back to deterministic synthesizer:', genErr);
        }
      }

      // Deterministic Algorithmic Synthesizer Fallback
      const lower = notes.toLowerCase();
      const isEnglish = lower.includes('english') || lower.includes('expat') || lower.includes('dental') || lower.includes('clinic');

      // Extract title / name
      const firstLine = notes.split('\n')[0].replace(/[#*]/g, '').trim();
      const businessName = firstLine.length > 3 && firstLine.length < 50 ? firstLine : isEnglish ? 'Nordic Express Services' : 'Viking VVS & Teknik';
      const slug = businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'client-' + Date.now().toString(36);

      const passkey = `CPK-${slug.substring(0, 8).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}-SEC`;

      const generatedPayload = {
        name: businessName,
        slug,
        owner_name: isEnglish ? 'Alexander Wright' : 'Lars Henriksen',
        owner_phone: '+4520304050',
        owner_email: `${slug.replace(/-/g, '')}@nordic-omni.io`,
        default_language: isEnglish ? 'en-US' : 'da-DK',
        telephony_mode: 'zero_cost_webrtc',
        flynumber_did: '+4570' + Math.floor(100000 + Math.random() * 900000),
        client_passkey: passkey,
        customer_system_prompt: isEnglish
          ? `You are the AI Voice Receptionist for ${businessName}. Answer customer phone calls politely and concisely. Quote prices from the catalog in DKK. If a customer reports an emergency or demands human intervention, immediately trigger a dire escalation.`
          : `Du er AI-receptionisten for ${businessName}. Svar kunder venligt, hurtigt og professionelt på dansk. Oplys priser fra kataloget. Ved akutte skader eller vrede kunder, udløs straks dire_escalation for at koble mester på.`,
        copilot_system_prompt: isEnglish
          ? `You are the Executive Operations AI Co-Pilot (God Mode) for the owner at ${businessName}. Execute operational commands, schedule changes, and pipeline briefings hands-free.`
          : `Du er den personlige driftsassistent (God Mode) for mester hos ${businessName}. Udfør instruktioner, åbningstidsændringer og pipeline-overblik.`,
        active_broadcast_message: isEnglish
          ? 'Notice: Standard response times active. Inbound emergency dispatch available 24/7.'
          : 'OBS: Almindelig drift aktiv. Døgnvagt tilgængelig for akutte henvendelser.',
        business_hours: {
          mon: { open: '08:00', close: '16:30', closed: false },
          tue: { open: '08:00', close: '16:30', closed: false },
          wed: { open: '08:00', close: '16:30', closed: false },
          thu: { open: '08:00', close: '16:30', closed: false },
          fri: { open: '08:00', close: '15:00', closed: false },
          sat: { open: '09:00', close: '14:00', closed: true },
          sun: { open: '00:00', close: '00:00', closed: true },
        },
        pricing_catalog: [
          { id: 'p_1', service: isEnglish ? 'Standard Service Call' : 'Autoriseret Timepris', price_dkk: 895, unit: 'hour' as const },
          { id: 'p_2', service: isEnglish ? 'Emergency Urgent Dispatch' : 'Akut Udrykning (Døgnvagt)', price_dkk: 2250, unit: 'call-out' as const },
          { id: 'p_3', service: isEnglish ? 'Comprehensive Diagnosis' : 'Komplet Gennemgang & Fejlfinding', price_dkk: 1450, unit: 'fixed' as const },
        ],
        knowledge_items: [
          {
            category: 'policy',
            title: isEnglish ? 'Payment Policy' : 'Betalingsbetingelser',
            content: isEnglish
              ? 'All payments are handled outside the software via net bank transfer or direct technician invoicing.'
              : 'Al betaling foregår uden om systemet via bankoverførsel eller direkte faktura fra montøren.',
          },
        ],
      };

      return NextResponse.json({
        success: true,
        tenantPayload: generatedPayload,
      });
    }

    return NextResponse.json({ error: 'Unsupported mode' }, { status: 400 });
  } catch (error: any) {
    console.error('Provision wizard route error:', error);
    return NextResponse.json(
      { error: 'Wizard processing failed', message: error?.message || 'Unknown' },
      { status: 500 }
    );
  }
}
