'use client';

import { useActionState, useEffect } from 'react';
import {
  createKnowledgeAction,
  updateKnowledgeAction,
} from './knowledge-actions';
import { EMPTY_STATE } from '@/lib/actions/types';
import { Field, Input, Textarea, FormAlert, buttonClass } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/SubmitButton';

export interface KnowledgeItemRow {
  id: string;
  title: string;
  content: string;
  category: string;
  priority: number;
}

const CATEGORIES = ['general', 'pricing', 'policy', 'hours', 'service', 'faq'] as const;

export function KnowledgeForm({
  tenantId,
  item,
  onDone,
}: {
  tenantId: string;
  item?: KnowledgeItemRow;
  onDone: () => void;
}) {
  const action = item ? updateKnowledgeAction : createKnowledgeAction;
  const [state, formAction] = useActionState(action, EMPTY_STATE);

  // Close the inline editor only after a confirmed success, never during render.
  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  const err = (f: string) => (state.field === f ? state.error : undefined);
  const uid = item?.id ?? 'new';

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      {item ? <input type="hidden" name="itemId" value={item.id} /> : null}

      {state.error ? <FormAlert tone="error">{state.error}</FormAlert> : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_140px_100px]">
        <Field htmlFor={`title-${uid}`} label="Title" error={err('title')}>
          <Input
            id={`title-${uid}`}
            name="title"
            defaultValue={item?.title ?? ''}
            placeholder="Never promise same-day delivery outside Copenhagen"
            invalid={Boolean(err('title'))}
            required
          />
        </Field>

        <Field htmlFor={`category-${uid}`} label="Category">
          <select
            id={`category-${uid}`}
            name="category"
            defaultValue={item?.category ?? 'general'}
            className="w-full rounded-[var(--r-sm)] border border-[var(--border-subtle)] bg-[var(--bg-ground)] px-2 py-2 text-xs text-[var(--text-primary)]"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>

        <Field htmlFor={`priority-${uid}`} label="Priority" hint="0–100">
          <Input
            id={`priority-${uid}`}
            name="priority"
            type="number"
            min={0}
            max={100}
            defaultValue={item?.priority ?? 50}
          />
        </Field>
      </div>

      <Field
        htmlFor={`content-${uid}`}
        label="What the agent should know"
        error={err('content')}
      >
        <Textarea
          id={`content-${uid}`}
          name="content"
          rows={3}
          defaultValue={item?.content ?? ''}
          placeholder="State the rule plainly, in the language the agent speaks."
          invalid={Boolean(err('content'))}
          required
        />
      </Field>

      <div className="flex items-center gap-2">
        <SubmitButton size="sm" pendingLabel="Saving…">
          {item ? 'Save changes' : 'Add rule'}
        </SubmitButton>
        <button type="button" onClick={onDone} className={buttonClass('ghost', 'sm')}>
          Cancel
        </button>
      </div>
    </form>
  );
}
