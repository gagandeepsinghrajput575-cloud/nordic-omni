'use client';

import { useActionState, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { agencyFactsAction } from '@/app/(agency)/agency/control-actions';
import { EMPTY_STATE } from '@/lib/actions/types';
import { Card, CardHeader } from '@/components/ui/core';
import { Input, Select, FormAlert, buttonClass } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/SubmitButton';

const DAYS = [['mon','Monday'],['tue','Tuesday'],['wed','Wednesday'],['thu','Thursday'],['fri','Friday'],['sat','Saturday'],['sun','Sunday']];
export function AgencyHoursEditor({ tenantId, hours }: { tenantId: string; hours: Record<string, { open: string; close: string; closed: boolean }> }) {
  const [state, action] = useActionState(agencyFactsAction, EMPTY_STATE);
  return <Card><CardHeader title="Business hours" hint="Europe/Copenhagen. Used by voice AI and customer chat." /><form key={JSON.stringify(hours)} action={action}><input type="hidden" name="tenantId" value={tenantId} /><input type="hidden" name="section" value="hours" />
    <div className="divide-y divide-[var(--line)]">{DAYS.map(([key,label]) => { const day = hours[key] ?? { open: '08:00', close: '16:00', closed: key === 'sun' }; return <div key={key} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"><span className="w-24 text-[13px] font-medium">{label}</span><label className="flex items-center gap-2 text-[12px] text-[var(--muted)]"><input type="checkbox" name={`${key}_closed`} defaultChecked={day.closed} />Closed</label><div className="flex items-center gap-2"><Input type="time" name={`${key}_open`} defaultValue={day.open} aria-label={`${label} opening time`} className="w-32" /><span aria-hidden>–</span><Input type="time" name={`${key}_close`} defaultValue={day.close} aria-label={`${label} closing time`} className="w-32" /></div></div>; })}</div>
    {state.error || state.message ? <div className="px-5 pb-4"><FormAlert tone={state.error ? 'error' : 'success'}>{state.error || state.message}</FormAlert></div> : null}<div className="form-footer"><SubmitButton pendingLabel="Saving…">Save business hours</SubmitButton></div>
  </form></Card>;
}

type Price = { service: string; price_dkk: number; unit: string };
export function AgencyPricingEditor({ tenantId, rows }: { tenantId: string; rows: Price[] }) {
  const [state, action] = useActionState(agencyFactsAction, EMPTY_STATE);
  const [prices, setPrices] = useState(rows.length ? rows : [{ service: '', price_dkk: 0, unit: 'fixed' }]);
  const update = (index: number, patch: Partial<Price>) => setPrices((old) => old.map((row, i) => i === index ? { ...row, ...patch } : row));
  return <Card><CardHeader title="Pricing catalog" hint="The receptionist can quote only these configured prices." action={<button type="button" className={buttonClass('secondary', 'sm')} disabled={prices.length >= 40} onClick={() => setPrices((old) => [...old, { service: '', price_dkk: 0, unit: 'fixed' }])}><Plus size={14} />Add service</button>} /><form action={action}><input type="hidden" name="tenantId" value={tenantId} /><input type="hidden" name="section" value="pricing" />
    <div className="space-y-4 p-5">{prices.map((row, index) => <div key={index} className="grid grid-cols-[1fr_100px_36px] gap-2 sm:grid-cols-[1fr_110px_130px_36px]"><Input name={`service_${index}`} value={row.service} onChange={(e) => update(index, { service: e.target.value })} placeholder="Service name" aria-label={`Service ${index + 1}`} className="col-span-3 sm:col-span-1" maxLength={200} /><Input type="number" min={0} step="any" name={`price_${index}`} value={row.price_dkk} onChange={(e) => update(index, { price_dkk: Number(e.target.value) })} aria-label={`Price in DKK for ${row.service || index + 1}`} /><Select name={`unit_${index}`} value={row.unit} onChange={(e) => update(index, { unit: e.target.value })} aria-label={`Unit ${index + 1}`}>{['fixed','hour','metre','unit','call-out'].map((unit) => <option key={unit}>{unit}</option>)}</Select><button type="button" className={buttonClass('ghost','sm','icon-button')} aria-label={`Remove ${row.service || `service ${index + 1}`}`} onClick={() => setPrices((old) => old.filter((_, i) => i !== index))}><Trash2 size={15} /></button></div>)}</div>
    {state.error || state.message ? <div className="px-5 pb-4"><FormAlert tone={state.error ? 'error' : 'success'}>{state.error || state.message}</FormAlert></div> : null}<div className="form-footer"><SubmitButton pendingLabel="Saving…">Save pricing catalog</SubmitButton></div>
  </form></Card>;
}
