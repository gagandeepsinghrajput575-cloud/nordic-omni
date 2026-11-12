'use client';

import { useState, type ReactNode } from 'react';
import { Building2, Clock3, Banknote, Bot } from 'lucide-react';
import { Tabs, tabPanelProps } from '@/components/ui/Tabs';

type Section = 'business' | 'hours' | 'pricing' | 'agent';

export function SettingsPanels({ isDanish, business, hours, pricing, agent }: {
  isDanish: boolean; business: ReactNode; hours: ReactNode; pricing: ReactNode; agent: ReactNode;
}) {
  const [active, setActive] = useState<Section>('business');
  const t = (da: string, en: string) => isDanish ? da : en;
  const items = [
    { id: 'business' as const, label: t('Virksomhed', 'Business'), icon: <Building2 size={15} /> },
    { id: 'hours' as const, label: t('Åbningstider', 'Hours'), icon: <Clock3 size={15} /> },
    { id: 'pricing' as const, label: t('Prisliste', 'Pricing'), icon: <Banknote size={15} /> },
    { id: 'agent' as const, label: t('AI-opsætning', 'AI configuration'), icon: <Bot size={15} /> },
  ];
  return (
    <div className="space-y-6">
      <Tabs id="portal-settings" items={items} value={active} onChange={setActive} label={t('Indstillinger', 'Settings sections')} />
      {/* Keep mounted so switching sections never discards an unsaved edit. */}
      <div {...tabPanelProps('portal-settings', active, 'business')} className="tab-enter">{business}</div>
      <div {...tabPanelProps('portal-settings', active, 'hours')} className="tab-enter">{hours}</div>
      <div {...tabPanelProps('portal-settings', active, 'pricing')} className="tab-enter">{pricing}</div>
      <div {...tabPanelProps('portal-settings', active, 'agent')} className="tab-enter">{agent}</div>
    </div>
  );
}
