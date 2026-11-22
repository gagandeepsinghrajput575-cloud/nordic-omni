# Project Instructions

## Mandatory UI-First Design Inspiration Rule

⚬ **STOP Before Writing UI Code**: Whenever the user requests ANY UI change (new page, redesign, component tweak, dashboard, modal, hero, landing page, styling, typography, animation, or visual polish), STOP before writing JSX/TSX/CSS and consult `design-inspiration` in depth as your primary design authority.
⚬ **No Generic AI Slop / Default Tailwind**: Never fall back to generic default Tailwind/AI-slop layouts. Every UI change must begin with a concise **Pre-Code Design Reference Brief** grounded in the 9-layer directory:
  1. **Primary Direction**: Ground in 1 benchmark (Awwwards / curated.design / Pinterest) — never blend conflicting styles.
  2. **Display & Body Font Pairing**: Select deliberate open-licensed pairings (Fontshare / Fonts In Use / Fontesk).
  3. **Restrained Color System**: Strict 5-token palette (Coolors: background, surface, text, border, 1 primary accent).
  4. **Section & Component Mapping**: Pull high-craft primitives (Supahero, Unsection, 21st.dev, Originkit, Spell UI, details.so).
  5. **Motion & Background Budget**: Max 1 focal motion (Kinetics / Kawaii / Animation Dictionary / Scrolltide) and max 1 subtle background depth (Gradient Lab / backgrounds.supply / Super Visuals); optional UI SFX (UI SFX / Bencho) only on explicit user actions with mute support.
⚬ **Domain Tone Matching**:
  - *Danish SMB trades, contractors & healthcare/clinics*: Prioritize grounded Nordic clarity, strong typographic hierarchy, high contrast, prominent direct CTAs, and fast mobile conversion over heavy 3D gimmicks.
  - *Agency showcases & AI demos*: Deploy controlled motion (Scrolltide / Kinetics) and subtle shader depth (Gradient Lab) on the hero only.
⚬ **Execution & Audit**: Build reusable tokens/components with mobile-first viewport testing, `prefers-reduced-motion` compliance, and a strict post-code visual audit.
