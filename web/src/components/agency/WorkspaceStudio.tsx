'use client';

import { useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Bot, Clock3, CreditCard, Globe, LayoutDashboard, UsersRound, Webhook } from 'lucide-react';
import { Tabs } from '@/components/ui/Tabs';

const ITEMS = [
  { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={15} /> },
  { id: 'team', label: 'Team & access', icon: <UsersRound size={15} /> },
  { id: 'hours', label: 'Business hours', icon: <Clock3 size={15} /> },
  { id: 'pricing', label: 'Pricing', icon: <CreditCard size={15} /> },
  { id: 'knowledge', label: 'Knowledge', icon: <Globe size={15} /> },
  { id: 'prompt', label: 'Prompt studio', icon: <Bot size={15} /> },
  { id: 'webhooks', label: 'Webhooks', icon: <Webhook size={15} /> },
] as const;
type Tab = typeof ITEMS[number]['id'];

export function WorkspaceStudio({ panels }: { panels: Record<Tab, ReactNode> }) {
  const [active, setActive] = useState<Tab>('overview');
  const reduced = useReducedMotion();
  return <div className="space-y-6"><Tabs id="workspace-studio" items={[...ITEMS]} value={active} onChange={setActive} label="Workspace management sections" />
    {ITEMS.map(({ id }) => <div key={id} role="tabpanel" id={`workspace-studio-panel-${id}`} aria-labelledby={`workspace-studio-tab-${id}`} hidden={active !== id} tabIndex={0}>
      {active === id ? <motion.div initial={reduced ? false : { opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}>{panels[id]}</motion.div> : panels[id]}
    </div>)}
  </div>;
}
