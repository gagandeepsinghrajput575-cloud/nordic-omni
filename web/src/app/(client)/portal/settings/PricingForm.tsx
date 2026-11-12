'use client';

import { useActionState, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { savePricingAction } from './actions';
import { EMPTY_STATE } from '@/lib/actions/types';
import { Card, CardHeader } from '@/components/ui/core';
import { Input, FormAlert } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/SubmitButton';

export interface PriceRow {
  id?: string;
  service: string;
  price_dkk: number;
  unit: string;
  estimate_model?: string;
  estimate_min_dkk?: number;
  estimate_max_dkk?: number;
}

const UNITS = [
  ['fixed', 'Fast pris'],
  ['hour', 'Per time'],
  ['metre', 'Per meter'],
  ['unit', 'Per stk.'],
] as const;

export function PricingForm({ isDanish, rows }: { isDanish: boolean; rows: PriceRow[] }) {
  const [state, formAction] = useActionState(savePricingAction, EMPTY_STATE);
  const [list, setList] = useState<PriceRow[]>(
    rows.length > 0 ? rows : [{ service: '', price_dkk: 0, unit: 'fixed' }]
  );

  const update = (i: number, patch: Partial<PriceRow>) =>
    setList((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <Card>
      <CardHeader
        title={isDanish ? 'Prisliste' : 'Price list'}
        hint={
          isDanish
            ? 'AI’en citerer kun priser herfra. Den finder aldrig på en pris.'
            : 'The AI only quotes from this list. It never invents a price.'
        }
        action={
          <button
            type="button"
            onClick={() =>
              setList((prev) => [...prev, { service: '', price_dkk: 0, unit: 'fixed' }])
            }
            className="inline-flex items-center gap-1 rounded-[var(--r-sm)] border border-[var(--border-subtle)] px-2 py-1 text-[10px] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)]"
          >
            <Plus size={11} />
            {isDanish ? 'Tilføj' : 'Add'}
          </button>
        }
      />

      <form action={formAction}>
        {state.error ? (
          <div className="px-5 pt-4">
            <FormAlert tone="error">{state.error}</FormAlert>
          </div>
        ) : null}
        {state.ok && state.message ? (
          <div className="px-5 pt-4">
            <FormAlert tone="success">{state.message}</FormAlert>
          </div>
        ) : null}

        <div className="space-y-2 p-5">
          {list.map((row, i) => {
            const hasPresetUnit = UNITS.some(([value]) => value === row.unit);
            return (
              <div key={i} className="flex items-center gap-2">
                {row.id ? <input type="hidden" name={`id_${i}`} value={row.id} /> : null}
                {row.estimate_model ? (
                  <input type="hidden" name={`estimate_model_${i}`} value={row.estimate_model} />
                ) : null}
                {row.estimate_min_dkk !== undefined ? (
                  <input type="hidden" name={`estimate_min_dkk_${i}`} value={String(row.estimate_min_dkk)} />
                ) : null}
                {row.estimate_max_dkk !== undefined ? (
                  <input type="hidden" name={`estimate_max_dkk_${i}`} value={String(row.estimate_max_dkk)} />
                ) : null}
                <Input
                  name={`service_${i}`}
                  value={row.service}
                  onChange={(e) => update(i, { service: e.target.value })}
                  placeholder={isDanish ? 'Fx: Udskiftning af blandingsbatteri' : 'e.g. Replace mixer tap'}
                  className="flex-1"
                  aria-label={`Service ${i + 1}`}
                />
                <Input
                  name={`price_${i}`}
                  type="number"
                  min={0}
                  step={50}
                  value={row.price_dkk}
                  onChange={(e) => update(i, { price_dkk: Number(e.target.value) })}
                  className="w-[110px] text-right font-mono"
                  aria-label={`Price ${i + 1}`}
                />
                <select
                  name={`unit_${i}`}
                  value={row.unit}
                  onChange={(e) => update(i, { unit: e.target.value })}
                  aria-label={`Unit ${i + 1}`}
                  className="w-[160px] rounded-[var(--r-sm)] border border-[var(--border-subtle)] bg-[var(--bg-ground)] px-2 py-2 text-xs text-[var(--text-primary)]"
                >
                  {!hasPresetUnit && row.unit ? (
                    <option value={row.unit}>{row.unit}</option>
                  ) : null}
                  {UNITS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setList((prev) => prev.filter((_, idx) => idx !== i))}
                  aria-label={isDanish ? 'Fjern linje' : 'Remove row'}
                  className="shrink-0 rounded-[var(--r-sm)] p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>

        <div className="border-t border-[var(--border-subtle)] p-5">
          <SubmitButton pendingLabel={isDanish ? 'Gemmer…' : 'Saving…'}>
            {isDanish ? 'Gem priser' : 'Save prices'}
          </SubmitButton>
        </div>
      </form>
    </Card>
  );
}
