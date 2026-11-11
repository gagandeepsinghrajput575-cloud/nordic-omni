-- Migration 0006: Seed Client #1 - Dansk Byg & Renovering ApS
-- Sets up Client #1 as an ironclad building and renovation contractor in Storkøbenhavn.

BEGIN;

-- 1. Update Tenant #1 to Dansk Byg & Renovering ApS
UPDATE tenants
   SET name = 'Dansk Byg & Renovering ApS',
       slug = 'dansk-byg',
       owner_name = 'Morten Bondo',
       owner_email = 'morten@danskbyg.dk',
       owner_phone = '+4530405060',
       default_language = 'da-DK',
       pricing_catalog = '[
         {"id": "trade-01", "service": "Tømrer & Bygningssnedker Timetakst", "price_dkk": 625, "unit": "time (ekskl. moms / 781,25 inkl. moms)"},
         {"id": "trade-02", "service": "Murer & Flisearbejde Timetakst", "price_dkk": 650, "unit": "time (ekskl. moms)"},
         {"id": "proj-bath", "service": "Komplet Nyt Badeværelse (inkl. vådrumssikring)", "price_dkk": 115000, "unit": "vejledende overslag (typisk 95.000 - 165.000 kr.)"},
         {"id": "proj-kitchen", "service": "Køkkenmontering & Tilpasning", "price_dkk": 45000, "unit": "vejledende overslag (typisk 35.000 - 75.000 kr.)"},
         {"id": "proj-extension", "service": "Tilbygning / Udestue", "price_dkk": 22000, "unit": "kr. pr. kvadratmeter (typisk 18.000 - 26.000 kr./m²)"},
         {"id": "proj-roof", "service": "Nyt Tag (Tegl/Betontagsten inkl. undertag)", "price_dkk": 1800, "unit": "kr. pr. kvadratmeter (typisk 1.400 - 2.400 kr./m²)"},
         {"id": "callout-urgent", "service": "Akut Udrykning (Vandskade / Tagskade / Storm)", "price_dkk": 2200, "unit": "udrykningsgebyr"}
       ]'::jsonb,
       business_hours = '{
         "mon": {"open": "07:00", "close": "17:00", "closed": false},
         "tue": {"open": "07:00", "close": "17:00", "closed": false},
         "wed": {"open": "07:00", "close": "17:00", "closed": false},
         "thu": {"open": "07:00", "close": "17:00", "closed": false},
         "fri": {"open": "07:00", "close": "15:30", "closed": false},
         "sat": {"open": "09:00", "close": "13:00", "closed": true},
         "sun": {"open": "00:00", "close": "00:00", "closed": true}
       }'::jsonb,
       active_broadcast_message = 'Gratis uforpligtende besigtigelse af alle større projekter i Storkøbenhavn og Nordsjælland.',
       updated_at = now()
 WHERE id = '11111111-1111-4111-8111-111111111111';

-- 2. Update Owner User
UPDATE users
   SET full_name = 'Morten Bondo',
       email = 'morten@danskbyg.dk',
       updated_at = now()
 WHERE id = 'b0000000-0000-4000-8000-000000000001';

-- 3. Update Tenant Agent Config
UPDATE tenant_agent_config
   SET customer_system_prompt = 'Du er den autoriserede AI-kundereceptionist for Dansk Byg & Renovering ApS i Glostrup. Vi servicerer Storkøbenhavn og Nordsjælland med tømrer-, murer- og totalentrepriser. Tal altid et flydende, høfligt og fagligt solidt dansk. Ved henvendelser om badeværelser, køkkener, tilbygninger eller nyt tag skal du afdække projektets omfang (kvadratmeter, nuværende stand, ønsket tidsramme) og give et vejledende overslag ("et vejledende overslag, ikke et bindende tilbud"). Tilbyd altid en gratis uforpligtende besigtigelse på adressen, hvor Morten Bondo kan gennemgå projektet. Registrer overslaget med record_project_estimate. Ved akutte skader (akut tagskade, nedstyrtningsfare eller vandindtrængning efter storm) skal du straks kalde trigger_dire_escalation.',
       greeting_script = 'Goddag, du er kommet til Dansk Byg & Renovering. Mit navn er Christel. Hvad kan vi hjælpe dig med at bygge eller renovere?',
       copilot_system_prompt = 'Du er den taktiske drifts-co-pilot for indehaver Morten Bondo hos Dansk Byg & Renovering ApS. Giv korte, præcise svar om pipeline, aktive byggesager, overslag og timepriser.',
       voice_id = 'azure:da-DK-ChristelNeural',
       stt_language = 'da-DK',
       escalation_policy = '{
         "emergency_fee_dkk": 2200,
         "emergency_keywords": ["vandskade", "tagskade", "oversvømmelse", "stormskade", "akut", "nedstyrtningsfare"],
         "min_lead_score_to_book": 50,
         "always_escalate_on_human_request": true
       }'::jsonb,
       updated_at = now()
 WHERE tenant_id = '11111111-1111-4111-8111-111111111111';

-- 4. Update Knowledge Items
DELETE FROM knowledge_items WHERE tenant_id = '11111111-1111-4111-8111-111111111111';

INSERT INTO knowledge_items (id, tenant_id, category, title, content, priority, is_active)
VALUES 
  (
    'c0000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'policy',
    'Betalingsbetingelser & Fakturering',
    'Al betaling foregår via bankoverførsel eller fremsendt faktura i henhold til aftalte milepæle (f.eks. ved opstart, råhus og aflevering). Vi modtager aldrig betaling i appen eller over telefonen.',
    60,
    true
  ),
  (
    'c0000000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    'standard',
    'Vådrumssikring & Bygningsreglementet BR18',
    'Alle badeværelser og vådrum etableres strengt efter Bygningsreglementet BR18 og SBI-anvisning 252 med MK-godkendt vådrumsmembran, lovpligtigt fald mod gulvafløb og autoriseret VVS- og el-tilslutning.',
    55,
    true
  ),
  (
    'c0000000-0000-4000-8000-000000000003',
    '11111111-1111-4111-8111-111111111111',
    'service',
    'Gratis Uforpligtende Besigtigelse',
    'Vi tilbyder altid gratis og uforpligtende besigtigelse i hele Storkøbenhavn og Nordsjælland, hvor Morten Bondo personligt besigtiger forholdene og udarbejder et fast, specificeret tilbud.',
    50,
    true
  );

-- 5. Seed Realistic Contacts for Client #1
UPDATE contacts
   SET full_name = 'Henrik Nielsen',
       phone_number = '+4520112233',
       email = 'henrik@nordicpost.dk',
       pipeline_stage = 'qualified',
       estimated_value_dkk = 125000.00,
       shared_memory_summary = 'Kunde ønsker komplet renovering af 8 m² badeværelse i rækkehus i Lyngby. Vejledende overslag på ca. 115.000-135.000 kr. afgivet. Ønsker uforpligtende besigtigelse.',
       updated_at = now()
 WHERE id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';

UPDATE contacts
   SET full_name = 'Sofie Amalie Møller',
       phone_number = '+4540223344',
       email = 'sofie@amalie-design.dk',
       pipeline_stage = 'contacted',
       estimated_value_dkk = 770000.00,
       shared_memory_summary = 'Forespørgsel på 35 m² tilbygning til villa i Charlottenlund med gulvvarme og foldedørsparti mod haven.',
       updated_at = now()
 WHERE id = 'dddddddd-dddd-4ddd-dddd-dddddddddddd';

UPDATE contacts
   SET full_name = 'Lars Thomsen',
       phone_number = '+4550334455',
       email = 'lars@thomsen-invest.dk',
       pipeline_stage = 'dire_escalated',
       estimated_value_dkk = 45000.00,
       shared_memory_summary = 'Akut tagskade efter nattens storm på villa i Glostrup. Tagsten løsnet og vand trængt igennem undertaget. Eftersøgt akut udrykning.',
       updated_at = now()
 WHERE id = 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee';

-- 6. Update Demo Call Log
UPDATE call_logs
   SET transcript_full = '[
     {"speaker": "agent", "text": "Goddag, du er kommet til Dansk Byg & Renovering. Mit navn er Christel. Hvad kan vi hjælpe dig med at bygge eller renovere?", "timestamp_ms": 0},
     {"speaker": "caller", "text": "Hej Christel, vi har et badeværelse på cirka syv-otte kvadratmeter i vores rækkehus i Lyngby, som trænger til en totalrenovering. Hvad koster sådan noget cirka hos jer?", "timestamp_ms": 4200},
     {"speaker": "agent", "text": "Det kan vi sagtens hjælpe med! For et komplet nyt badeværelse inklusive vådrumssikring efter BR18 ligger vores vejledende overslag typisk mellem 95.000 og 165.000 kroner, afhængigt af valg af fliser og sanitet. Vil du have Morten ud til en gratis uforpligtende besigtigelse, så vi kan give et fast tilbud?", "timestamp_ms": 11500},
     {"speaker": "caller", "text": "Det lyder super fornuftigt. Kan han tirsdag formiddag?", "timestamp_ms": 22100},
     {"speaker": "agent", "text": "Ja, jeg har noteret tirsdag formiddag klokken ti på din adresse. Jeg bekræfter hermed aftalen. Du modtager en bekræftelse på SMS.", "timestamp_ms": 28400}
   ]'::jsonb,
   summary = 'Forespørgsel på totalrenovering af 8 m² badeværelse i Lyngby. Vejledende overslag 125.000 DKK afgivet. Gratis besigtigelse aftalt tirsdag kl. 10.',
   updated_at = now()
 WHERE room_name = 'kbh-vvs_call_aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';

COMMIT;
