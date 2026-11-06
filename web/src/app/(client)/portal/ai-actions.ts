'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/guard';
import { getTenantFacts, getTenantOverview, searchContacts } from '@/lib/db/queries';
import { updateTenantFacts, type TenantFactsPatch } from '@/lib/db/mutations';

export interface AiCommandResult {
  ok: boolean;
  reply?: string;
  actionTaken?: string;
  updatedFields?: string[];
  navigateTo?: string;
  error?: string;
}

export async function executeClientAiCommand(prompt: string): Promise<AiCommandResult> {
  const session = await requireUser();
  const tenantId = session.tenantIds[0];
  if (!tenantId) {
    return { ok: false, error: 'Ingen adgang til arbejdsrum (No tenant access)' };
  }

  const cleanPrompt = prompt.trim();
  if (!cleanPrompt || cleanPrompt.length < 2) {
    return { ok: false, error: 'Skriv en kommando til din AI (Please write a command)' };
  }

  const [tenant, overview] = await Promise.all([
    getTenantFacts(session.userId, tenantId),
    getTenantOverview(session.userId, tenantId),
  ]);

  if (!tenant) {
    return { ok: false, error: 'Virksomhed ikke fundet' };
  }

  const isDanish = tenant.default_language?.startsWith('da') ?? true;
  const lower = cleanPrompt.toLowerCase();

  const patch: TenantFactsPatch = {};
  const updatedFields: string[] = [];
  let actionTaken = '';
  let reply = '';
  let navigateTo: string | undefined;

  const wantsSettings = lower.includes('indstill') || lower.includes('setting');
  const wantsLeads = lower.includes('kunder') || lower.includes('leads') || lower.includes('callers');
  const wantsNewLead = lower.includes('ny kunde') || lower.includes('opret kunde') || lower.includes('new lead') || lower.includes('create lead');
  const wantsDashboard = lower.includes('overblik') || lower.includes('dashboard') || lower.includes('hjem') || lower.includes('home');

  // --- 0. EXPLICIT UI NAVIGATION INTENTS --------------------------------------
  if (
    lower.startsWith('gå til') ||
    lower.startsWith('åbn') ||
    lower.startsWith('vis') ||
    lower.startsWith('naviger') ||
    lower.startsWith('find') ||
    lower.startsWith('se') ||
    lower.startsWith('open') ||
    lower.startsWith('go to') ||
    lower.startsWith('show') ||
    lower.startsWith('navigate')
  ) {
    if (wantsNewLead) {
      return {
        ok: true,
        reply: isDanish ? '🚀 Åbner formularen til at oprette en ny kunde...' : '🚀 Opening new caller form...',
        navigateTo: '/portal/leads/new',
        actionTaken: 'navigate_new_lead',
      };
    }
    if (wantsSettings && !lower.includes('sæt') && !lower.includes('opdater')) {
      return {
        ok: true,
        reply: isDanish ? '🚀 Navigerer til Virksomhedsindstillinger...' : '🚀 Navigating to Company Settings...',
        navigateTo: '/portal/settings',
        actionTaken: 'navigate_settings',
      };
    }
    if (wantsLeads && !lower.includes('kunde ') && !lower.includes('kunden ')) {
      return {
        ok: true,
        reply: isDanish ? '🚀 Navigerer til Kundeoversigten...' : '🚀 Navigating to Callers overview...',
        navigateTo: '/portal/leads',
        actionTaken: 'navigate_leads',
      };
    }
    if (wantsDashboard) {
      return {
        ok: true,
        reply: isDanish ? '🚀 Navigerer til Overblik...' : '🚀 Navigating to Dashboard Overview...',
        navigateTo: '/portal',
        actionTaken: 'navigate_dashboard',
      };
    }

    // Try finding a specific contact by name or number!
    const query = cleanPrompt
      .replace(/^(gå til|åbn|vis|naviger til|find|se|open|go to|show|navigate to)\s*(?:kunde|kunden|caller|lead)?/i, '')
      .replace(/^[:\s-]+/, '')
      .trim();

    if (query && query.length >= 2) {
      const contacts = await searchContacts(session.userId, tenantId, query);
      if (contacts.length > 0) {
        const contact = contacts[0];
        return {
          ok: true,
          reply: isDanish
            ? `🚀 Fandt "${contact.full_name}" (${contact.phone_number ?? 'intet tlf'}). Åbner kundekort...`
            : `🚀 Found "${contact.full_name}". Opening caller profile...`,
          navigateTo: `/portal/leads/${contact.id}`,
          actionTaken: 'navigate_contact_detail',
        };
      }
    }
  }

  // --- 1. BROADCAST / OPSLAG -------------------------------------------------
  if (
    lower.includes('fjern besked') ||
    lower.includes('ryd besked') ||
    lower.includes('slet broadcast') ||
    lower.includes('clear broadcast') ||
    lower.includes('fjern opslag')
  ) {
    patch.activeBroadcastMessage = null;
    updatedFields.push('activeBroadcastMessage');
    actionTaken = 'clear_broadcast';
    reply = isDanish
      ? '✅ Broadcast-beskeden er nu fjernet. Telefonsvareren læser ikke længere en særskilt varsel op.'
      : '✅ Broadcast message removed. The AI receptionist will no longer speak a special notice.';
    if (wantsSettings) navigateTo = '/portal/settings';
  } else if (
    lower.startsWith('sæt besked') ||
    lower.startsWith('opdater besked') ||
    lower.startsWith('broadcast:') ||
    lower.startsWith('opslag:') ||
    lower.includes('ny besked') ||
    lower.startsWith('set broadcast') ||
    lower.startsWith('update broadcast')
  ) {
    const rawMsg = cleanPrompt
      .replace(/^(sæt besked|opdater besked|broadcast:|opslag:|ny besked:|ny besked|set broadcast:|update broadcast:)/i, '')
      .replace(/^[:\s-]+/, '')
      .trim();

    if (rawMsg) {
      patch.activeBroadcastMessage = rawMsg;
      updatedFields.push('activeBroadcastMessage');
      actionTaken = 'update_broadcast';
      reply = isDanish
        ? `📢 Opslag opdateret: "${rawMsg}". Dette læses nu op af din AI-receptionist.`
        : `📢 Broadcast updated: "${rawMsg}". Your AI receptionist will quote this immediately.`;
      if (wantsSettings) navigateTo = '/portal/settings';
    }
  }

  // --- 2. PRICING & RATES (TIMETAKST / AKUT UDRYKNING / NY SERVICE) ---------
  const priceMatch = lower.match(/(\d+[\.,]?\d*)\s*(?:kr|dkk)/i) || lower.match(/(?:til|to)\s*(\d+)/i);
  if (!actionTaken && priceMatch) {
    const newPrice = parseInt(priceMatch[1].replace(/[.,]/g, ''), 10);

    if (!isNaN(newPrice) && newPrice > 0) {
      const catalog = Array.isArray(tenant.pricing_catalog) ? [...tenant.pricing_catalog] : [];

      if (lower.includes('time') || lower.includes('hourly') || lower.includes('timetakst')) {
        let found = false;
        for (const item of catalog) {
          if (item.service.toLowerCase().includes('time') || item.unit === 'hour') {
            item.price_dkk = newPrice;
            found = true;
            break;
          }
        }
        if (!found) {
          catalog.unshift({
            id: `p_${Date.now()}`,
            service: isDanish ? 'Autoriseret Timetakst' : 'Standard Hourly Rate',
            price_dkk: newPrice,
            unit: 'hour',
          });
        }
        patch.pricingCatalog = catalog;
        updatedFields.push('pricing_catalog');
        actionTaken = 'update_hourly_rate';
        reply = isDanish
          ? `💰 Timetakst opdateret til ${newPrice.toLocaleString('da-DK')} DKK/time. Telefonsvareren citerer nu denne pris.`
          : `💰 Hourly rate updated to ${newPrice} DKK/hr. Your AI receptionist will now quote this price.`;
        if (wantsSettings) navigateTo = '/portal/settings';
      } else if (
        lower.includes('akut') ||
        lower.includes('udrykning') ||
        lower.includes('døgn') ||
        lower.includes('emergency') ||
        lower.includes('call-out')
      ) {
        let found = false;
        for (const item of catalog) {
          if (
            item.service.toLowerCase().includes('akut') ||
            item.service.toLowerCase().includes('døgn') ||
            item.service.toLowerCase().includes('emergency')
          ) {
            item.price_dkk = newPrice;
            found = true;
            break;
          }
        }
        if (!found) {
          catalog.push({
            id: `p_${Date.now()}`,
            service: isDanish ? 'Akut Døgnvagt Udrykning' : 'Emergency Call-out',
            price_dkk: newPrice,
            unit: 'call-out',
          });
        }
        patch.pricingCatalog = catalog;
        updatedFields.push('pricing_catalog');
        actionTaken = 'update_emergency_rate';
        reply = isDanish
          ? `🚨 Akut døgnvagtsgebyr opdateret til ${newPrice.toLocaleString('da-DK')} DKK. Kunder oplyses om det ved akutte henvendelser.`
          : `🚨 Emergency call-out fee updated to ${newPrice} DKK. Callers with emergencies will be informed.`;
        if (wantsSettings) navigateTo = '/portal/settings';
      } else if (lower.includes('tilføj') || lower.includes('add')) {
        const serviceName = cleanPrompt
          .replace(/^(tilføj service|tilføj|add service|add)/i, '')
          .replace(/(for|til|at|price|på)\s*\d+.*$/i, '')
          .replace(/^[:\s-]+/, '')
          .trim() || (isDanish ? 'Ny Serviceydelse' : 'Custom Service');

        catalog.push({
          id: `p_${Date.now()}`,
          service: serviceName,
          price_dkk: newPrice,
          unit: 'fixed',
        });
        patch.pricingCatalog = catalog;
        updatedFields.push('pricing_catalog');
        actionTaken = 'add_service';
        reply = isDanish
          ? `✨ Tilføjet ny service: "${serviceName}" til ${newPrice.toLocaleString('da-DK')} DKK.`
          : `✨ Added new service: "${serviceName}" at ${newPrice} DKK.`;
        if (wantsSettings) navigateTo = '/portal/settings';
      }
    }
  }

  // --- 3. BUSINESS HOURS (ÅBNINGSTIDER) --------------------------------------
  const daysMap: Record<string, string> = {
    mandag: 'mon',
    tirsdag: 'tue',
    onsdag: 'wed',
    torsdag: 'thu',
    fredag: 'fri',
    lørdag: 'sat',
    søndag: 'sun',
    monday: 'mon',
    tuesday: 'tue',
    wednesday: 'wed',
    thursday: 'thu',
    friday: 'fri',
    saturday: 'sat',
    sunday: 'sun',
  };

  for (const [dayName, dayKey] of Object.entries(daysMap)) {
    if (lower.includes(dayName)) {
      const timeMatch = lower.match(/(?:kl\.?|at)?\s*(\d{1,2})[:.]?(\d{2})?/i);
      const isClosing = lower.includes('luk') || lower.includes('close');
      const isOpening = lower.includes('åbn') || lower.includes('open');
      const isClosedAllDay = lower.includes('lukket hele') || lower.includes('closed all day') || lower.includes('holder lukket');

      const hours = { ...(tenant.business_hours || {}) };
      const currentDay = hours[dayKey] || { open: '08:00', close: '16:00', closed: false };

      if (isClosedAllDay) {
        hours[dayKey] = { ...currentDay, closed: true };
        patch.businessHours = hours;
        updatedFields.push('business_hours');
        actionTaken = 'update_hours_closed';
        reply = isDanish
          ? `🕒 Opdateret: ${dayName.toUpperCase()} er nu markeret som LUKKET.`
          : `🕒 Updated: ${dayName.toUpperCase()} is now set to CLOSED.`;
        if (wantsSettings) navigateTo = '/portal/settings';
        break;
      } else if (timeMatch) {
        const hour = timeMatch[1].padStart(2, '0');
        const min = (timeMatch[2] || '00').padStart(2, '0');
        const timeStr = `${hour}:${min}`;

        if (isClosing) {
          hours[dayKey] = { ...currentDay, close: timeStr, closed: false };
          patch.businessHours = hours;
          updatedFields.push('business_hours');
          actionTaken = 'update_closing_time';
          reply = isDanish
            ? `🕒 Lukketid for ${dayName} er opdateret til kl. ${timeStr}.`
            : `🕒 Closing time for ${dayName} updated to ${timeStr}.`;
          if (wantsSettings) navigateTo = '/portal/settings';
          break;
        } else if (isOpening) {
          hours[dayKey] = { ...currentDay, open: timeStr, closed: false };
          patch.businessHours = hours;
          updatedFields.push('business_hours');
          actionTaken = 'update_opening_time';
          reply = isDanish
            ? `🕒 Åbningstid for ${dayName} er opdateret til kl. ${timeStr}.`
            : `🕒 Opening time for ${dayName} updated to ${timeStr}.`;
          if (wantsSettings) navigateTo = '/portal/settings';
          break;
        }
      }
    }
  }

  // --- 4. PHONE / CONTACT INFO ----------------------------------------------
  const phoneMatch = cleanPrompt.match(/(?:\+45)?\s*(\d{2}\s*\d{2}\s*\d{2}\s*\d{2})/);
  if (!actionTaken && phoneMatch && (lower.includes('telefon') || lower.includes('phone') || lower.includes('nummer'))) {
    const rawNum = phoneMatch[1].replace(/\s+/g, '');
    patch.ownerPhone = `+45 ${rawNum.slice(0, 2)} ${rawNum.slice(2, 4)} ${rawNum.slice(4, 6)} ${rawNum.slice(6, 8)}`;
    updatedFields.push('owner_phone');
    actionTaken = 'update_phone';
    reply = isDanish
      ? `📞 Indehavers telefonnummer er opdateret til ${patch.ownerPhone}.`
      : `📞 Owner phone updated to ${patch.ownerPhone}.`;
    if (wantsSettings) navigateTo = '/portal/settings';
  }

  // --- 5. QUERY / STATS INQUIRY (PIPELINE, STATUS) ---------------------------
  if (!actionTaken) {
    if (lower.includes('pipeline') || lower.includes('omsætning') || lower.includes('værdi')) {
      reply = isDanish
        ? `📊 Din nuværende pipeline værdi er ${overview.pipeline_dkk.toLocaleString('da-DK')} DKK fordelt på ${overview.contacts} registrerede kunder (${overview.booked} bookede aftaler).`
        : `📊 Your current pipeline value is ${overview.pipeline_dkk.toLocaleString('da-DK')} DKK across ${overview.contacts} callers (${overview.booked} booked appointments).`;
      return { ok: true, reply, actionTaken: 'query_pipeline' };
    }

    if (lower.includes('akut') || lower.includes('nødsag') || lower.includes('emergency')) {
      reply = isDanish
        ? `🚨 Du har lige nu ${overview.dire} akut sag(er) markeret i systemet.`
        : `🚨 You currently have ${overview.dire} active emergency case(s).`;
      return { ok: true, reply, actionTaken: 'query_dire', navigateTo: '/portal/leads' };
    }

    if (lower.includes('hjælp') || lower.includes('help') || lower.includes('hvad kan du')) {
      reply = isDanish
        ? '💡 Du kan styre hele systemet med naturligt sprog:\n• "Gå til kunder" eller "Find Morten Bondo"\n• "Åbn indstillinger" eller "Opret ny kunde"\n• "Sæt timetakst til 950 kr og åbn indstillinger"\n• "Sæt besked: Ferielukket fredag"\n• "Luk fredag kl 14:00"'
        : '💡 You can direct the entire system in natural English:\n• "Go to callers" or "Find caller Morten"\n• "Open settings" or "Create new lead"\n• "Set hourly rate to 950 DKK and show settings"\n• "Set broadcast: Closed Friday"\n• "Close Friday at 14:00"';
      return { ok: true, reply, actionTaken: 'help' };
    }
  }

  // If updates were queued, apply them to PostgreSQL!
  if (Object.keys(patch).length > 0) {
    await updateTenantFacts(session.userId, tenantId, patch);
    revalidatePath('/portal');
    revalidatePath('/portal/settings');
    return {
      ok: true,
      reply,
      actionTaken,
      updatedFields,
      navigateTo,
    };
  }

  // Fallback polite guidance
  return {
    ok: false,
    reply: isDanish
      ? `Jeg forstod: "${cleanPrompt}". Prøv f.eks. "Vis kunder", "Gå til indstillinger", "Find Morten", eller "Sæt timetakst til 950 kr".`
      : `I understood: "${cleanPrompt}". Try: "Go to callers", "Open settings", "Find Morten", or "Set hourly rate to 950 DKK".`,
  };
}
