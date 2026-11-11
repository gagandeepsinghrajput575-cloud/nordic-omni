# Client Onboarding Questionnaire & Specification Framework

> This document defines the rapid onboarding checklist used whenever starting work on a new client (Client #1, #2, #3, etc.). Instead of configuring bloated UI settings, the user answers these modular questions in chat to generate the client's dedicated setup.

---

## The Onboarding Checklist (Triggered in Chat)

Whenever you state: *"Let's get started with Client #X"*, the AI prompts with this exact modular checklist:

### 1. Business Basics
- **Company Name**: e.g., *Dansk Byg & Renovering ApS*
- **Trade / Industry**: e.g., *Building, Carpentry, Masonry & Total Contracting*
- **Operating Location**: e.g., *Storkøbenhavn & Nordsjælland*
- **Contact Details**: Owner Name, Email, Primary Phone Number

### 2. Feature Selection ("Do you want this or not?")
1. **AI Voice & WebRTC Intake Receptionist?** [Yes / No]
   - *Default: Yes*
2. **AI Lead & Project Estimation Engine?** [Yes / No]
   - *Default: Yes* (Scopes projects like bathrooms, kitchens, extensions, and gives grounded ballpark ranges)
3. **High-Speed Conversion Website & Traditional SEO?** [Yes / No]
   - *Default: As requested*
4. **AI Search Engine Optimization (GEO - llms.txt & Perplexity/ChatGPT SGE)?** [Yes / No]
   - *Default: As requested*
5. **Emergency 24/7 Call Escalation to Owner?** [Yes / No]
   - *Default: Yes*

### 3. Pricing & Estimation Catalog
- **Hourly Rates**: Standard craft hourly rate (tømrer/murer/VVS)
- **Project Brackets**:
  - Small jobs (e.g., døre/vinduer, service)
  - Medium jobs (e.g., nyt badeværelse, køkkenmontering)
  - Large projects (e.g., tilbygning m², nyt tag m²)
- **Emergency / Out-of-hours fees**: Call-out fees if applicable

### 4. Language & Voice
- **Primary Language**: Danish (`da-DK`) or English (`en-US`)
- **Tone & Persona**:
  - *Danish Friendly/Authoritative*: Azure `da-DK-ChristelNeural` or `da-DK-JeppeNeural`
  - *Fast Ultra-low Latency*: Cartesia `sonic-3`

---

## Standardized Output per Client
When answered, the AI scaffolds and validates:
- `clients/<client-slug>/client.config.json`
- Dedicated tenant facts and pricing catalog in PostgreSQL
- The voice selection and a safe default prompt if the tenant is new
- The same `/portal` route, scoped by the signed-in user's tenant membership

### Apply a client config

From `agent-worker/`:

```bash
.venv/bin/python scripts/apply_client_config.py ../clients/<slug>/client.config.json --validate-only
.venv/bin/python scripts/apply_client_config.py ../clients/<slug>/client.config.json
```

The apply step is idempotent for tenant id and refuses a slug owned by another
tenant. It intentionally does **not** overwrite an existing agency-authored
prompt, create a password, publish a website, or claim that SMS/calendar
delivery is configured. Those remain explicit follow-up actions.

Each estimation item should include `estimate_model` (`fixed` or
`per_square_meter`), `estimate_min_dkk`, and `estimate_max_dkk`. Display strings
are still accepted for backward compatibility, but structured values are the
source of truth.

