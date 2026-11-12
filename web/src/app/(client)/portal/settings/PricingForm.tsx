'use client';

import { useActionState, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { savePricingAction } from './actions';
import { EMPTY_STATE } from '@/lib/actions/types';
import { Card, CardHeader } from '@/components/ui/core';
import { Input, Select, FormAlert, buttonClass } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/SubmitButton';

export interface PriceRow { service: string; price_dkk: number; unit: string }
const UNITS = [
  ['fixed', 'Fast pris', 'Fixed price'], ['hour', 'Pr. time', 'Per hour'],
  ['metre', 'Pr. meter', 'Per metre'], ['unit', 'Pr. stk.', 'Per unit'], ['call-out', 'Udrykning', 'Call-out'],
] as const;

export function PricingForm({ isDanish, rows }: { isDanish: boolean; rows: PriceRow[] }) {
  const [state, formAction] = useActionState(savePricingAction, EMPTY_STATE);
  const [list, setList] = useState<PriceRow[]>(rows.length > 0 ? rows : [{ service: '', price_dkk: 0, unit: 'fixed' }]);
  const t = (da: string, en: string) => isDanish ? da : en;
  const update = (index: number, patch: Partial<PriceRow>) => setList((previous) => previous.map((row, current) => current === index ? { ...row, ...patch } : row));
  const add = () => setList((previous) => previous.length < 40 ? [...previous, { service: '', price_dkk: 0, unit: 'fixed' }] : previous);

  return (
    <Card>
      <CardHeader title={t('Prisliste', 'Price list')} hint={t('AI’en citerer kun priser herfra. Den finder aldrig på en pris.', 'The AI only quotes prices from this list. It never invents a price.')} action={<button type="button" onClick={add} disabled={list.length >= 40} className={buttonClass('secondary', 'sm')}><Plus size={14} />{t('Tilføj ydelse', 'Add service')}</button>} />
      <form action={formAction}>
        {(state.error || state.message) ? <div className="px-5 pt-4"><FormAlert tone={state.error ? 'error' : 'success'}>{state.error || state.message}</FormAlert></div> : null}
        <div className="space-y-4 p-5">
          {list.length > 0 ? <div className="hidden grid-cols-[minmax(0,1fr)_110px_140px_36px] gap-3 text-[12px] text-[var(--muted)] sm:grid"><span>{t('Ydelse', 'Service')}</span><span className="text-right">{t('Pris · DKK', 'Price · DKK')}</span><span>{t('Enhed', 'Unit')}</span><span /></div> : <p className="py-5 text-center text-[13px] text-[var(--muted)]">{t('Tilføj en ydelse for at bygge din prisliste.', 'Add a service to start your price list.')}</p>}
          {list.map((row, index) => <div key={index} className="enter grid grid-cols-[minmax(0,1fr)_110px_36px] items-center gap-2 border-b border-[var(--line)] pb-4 last:border-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_110px_140px_36px] sm:gap-3 sm:border-0 sm:pb-0">
            <Input name={`service_${index}`} value={row.service} onChange={(event) => update(index, { service: event.target.value })} placeholder={t('Fx: Udskiftning af blandingsbatteri', 'e.g. Replace mixer tap')} className="col-span-3 sm:col-span-1" aria-label={`${t('Ydelse', 'Service')} ${index + 1}`} maxLength={200} />
            <Input name={`price_${index}`} type="number" min={0} step={50} value={row.price_dkk} onChange={(event) => update(index, { price_dkk: Number(event.target.value) })} className="text-right" aria-label={`${t('Pris i DKK', 'Price in DKK')} ${index + 1}`} />
            <Select name={`unit_${index}`} value={row.unit} onChange={(event) => update(index, { unit: event.target.value })} aria-label={`${t('Enhed', 'Unit')} ${index + 1}`}>{UNITS.map(([value, da, en]) => <option key={value} value={value}>{t(da, en)}</option>)}</Select>
            <button type="button" onClick={() => setList((previous) => previous.filter((_, current) => current !== index))} aria-label={`${t('Fjern', 'Remove')} ${row.service || `${t('ydelse', 'service')} ${index + 1}`}`} className={buttonClass('ghost', 'sm', 'icon-button hover:text-[var(--danger)]')}><Trash2 size={15} /></button>
          </div>)}
          <p className="pt-1 text-[11px] text-[var(--muted)]">{t('Alle priser er i DKK. Op til 40 ydelser. Tomme ydelsesnavne gemmes ikke.', 'All prices are in DKK. Up to 40 services. Rows without a service name are not saved.')}</p>
        </div>
        <div className="form-footer"><SubmitButton pendingLabel={t('Gemmer…', 'Saving…')}>{t('Gem priser', 'Save prices')}</SubmitButton></div>
      </form>
    </Card>
  );
}
