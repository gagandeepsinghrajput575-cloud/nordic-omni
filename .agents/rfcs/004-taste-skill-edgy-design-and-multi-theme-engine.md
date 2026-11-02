# RFC 004: Taste-Skill Edgy Design System & Multi-Theme Engine

**Status**: APPROVED  
**Harness**: Intelligent-Internet/zenith  
**Skill**: Leonxlnx/taste-skill (`design-taste-frontend`)  
**Mission**: Visual Transformation of NORDIC-OMNI into a High-Contrast, Anti-Slop, Multi-Theme Command Platform

---

## 1. Problem Statement
The current interface of NORDIC-OMNI has functional capabilities (multi-tenant provisioning, DeepSeek architect, passkey shield, WebRTC voice agent, human takeover), but its styling relies on standard dark gradients and rounded generic containers that risk looking like standard template defaults.

The user has installed `Leonxlnx/taste-skill` and explicitly requested:
1. **Edgy, high-contrast aesthetic**: Moving away from bloated generic gradients and circular icon badges toward sharp 1px structural framing, authentic data density, IBM Plex typography with tabular numerals, and tactical HUD silhouettes.
2. **Carefully chosen color palettes**: Intentional palette pairs where chroma belongs to the data and meaningful status signals (emergency/akut red, live connection cyan, volt status), not decorative chrome.
3. **Multi-theme support**: Instant switching between 3 distinct edgy modes:
   - **Nordic Noir** (Cyber Obsidian + Cyan + Razor Pink)
   - **Industrial Volt** (Monochrome Slab + Radioactive Lime `#D4FF00`)
   - **Surgical Daylight** (Ultra-Crisp Technical Paper + Cobalt Blue)
4. **Subagent Execution & Zenith Harness Compliance**: Using autonomous subagents and strict build/lint validation gates.

---

## 2. Technical Architecture

### 2.1 CSS Theme Architecture (`globals.css`)
We define CSS variable tokens scoped by root theme classes:
- `.theme-nordic-noir`:
  - `--bg-ground`: `#07090E`
  - `--bg-surface`: `#0D111A`
  - `--bg-raised`: `#141A26`
  - `--border-subtle`: `#1E2638`
  - `--border-strong`: `#2B374E`
  - `--text-primary`: `#F8FAFC`
  - `--text-secondary`: `#94A3B8`
  - `--text-muted`: `#64748B`
  - `--accent`: `#00F5D4`
  - `--accent-contrast`: `#000000`
  - `--accent-secondary`: `#7B61FF`
  - `--danger`: `#FF2A85`
  - `--warning`: `#F59E0B`
  - `--success`: `#10B981`

- `.theme-industrial-volt`:
  - `--bg-ground`: `#000000`
  - `--bg-surface`: `#0A0C0F`
  - `--bg-raised`: `#12151B`
  - `--border-subtle`: `#1C212B`
  - `--border-strong`: `#2D3445`
  - `--text-primary`: `#FFFFFF`
  - `--text-secondary`: `#A1A1AA`
  - `--text-muted`: `#71717A`
  - `--accent`: `#D4FF00`
  - `--accent-contrast`: `#000000`
  - `--accent-secondary`: `#FFFFFF`
  - `--danger`: `#EF4444`
  - `--warning`: `#EAB308`
  - `--success`: `#22C55E`

- `.theme-surgical-daylight`:
  - `--bg-ground`: `#F4F6F9`
  - `--bg-surface`: `#FFFFFF`
  - `--bg-raised`: `#EDF1F7`
  - `--border-subtle`: `#E2E6EC`
  - `--border-strong`: `#CBD5E1`
  - `--text-primary`: `#090A10`
  - `--text-secondary`: `#334155`
  - `--text-muted`: `#64748B`
  - `--accent`: `#1D4ED8`
  - `--accent-contrast`: `#FFFFFF`
  - `--accent-secondary`: `#0284C7`
  - `--danger`: `#DC2626`
  - `--warning`: `#D97706`
  - `--success`: `#16A34A`

### 2.2 Theme Provider & Hook (`web/src/lib/theme/ThemeContext.tsx`)
- Exports `ThemeProvider`, `useTheme()`, with type `ThemeMode = 'nordic-noir' | 'industrial-volt' | 'surgical-daylight'`.
- Persists to `localStorage.getItem('nordic-omni-theme')`.
- Listens to document mount and applies matching class to `document.documentElement` and `document.body`.

### 2.3 Theme Switcher Control (`web/src/components/theme/ThemeSwitcher.tsx`)
- Tactical segmented control or popup with clean icon + label badges.
- Placed in top navigation bar of `/portal/[tenantSlug]`, `/super-admin`, and `/call/[contactId]`.

---

## 3. Component Visual Enhancements (Per Taste-Skill App Rules)
1. **Interactive Kanban**:
   - Replace bloated pill columns with crisp 1px bordered columns.
   - Stage titles with monospace count indicators.
   - Numerical values in `tabular-nums` monospace.
2. **Animated Scorecards**:
   - Adhere to taste-skill §2: KPIs are type, not decorative circular icons; authentic delta comparisons.
3. **Owner Broadcast Banner**:
   - High-contrast marquee/bulletin styling with stark tactical accents.
4. **Lead 360 Drawer**:
   - High-density operator HUD with crisp tab headers and immediate "AI Auto-Pilot" toggle.
5. **Super-Admin Deck**:
   - Data-first tenant management table with copyable CPK passkey pills.

---

## 4. Verification Plan
- `npm run build` in `web/` must compile with 0 errors.
- Theme switching must toggle classes on `document.documentElement` without page reload or layout shift.
- Visual QA subagent verification of desktop and mobile layouts.

