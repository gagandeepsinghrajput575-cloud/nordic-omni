'use client';

import { useState } from 'react';
import { BookOpen, Pencil, Plus, Trash2, X } from 'lucide-react';
import { deleteKnowledgeAction } from './knowledge-actions';
import { Badge, Card, CardHeader } from '@/components/ui/core';
import { buttonClass } from '@/components/ui/form';
import { EmptyState } from '@/components/ui/feedback';
import { KnowledgeForm, type KnowledgeItemRow } from './KnowledgeForm';

export function KnowledgeEditor({ tenantId, items }: { tenantId: string; items: KnowledgeItemRow[] }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader title="Knowledge" hint="Approved rules and facts the receptionist may cite. Only the agency can edit these." action={<div className="flex items-center gap-2"><Badge tone="neutral">{items.length}</Badge><button type="button" onClick={() => { setAdding((value) => !value); setEditingId(null); }} className={buttonClass('secondary', 'sm')}>{adding ? <X size={13} /> : <Plus size={13} />}{adding ? 'Cancel' : 'Add rule'}</button></div>} />
      {adding ? <div className="border-b border-[var(--line)] bg-[var(--bg-raised)] p-5"><KnowledgeForm tenantId={tenantId} onDone={() => setAdding(false)} /></div> : null}
      {items.length === 0 && !adding ? <EmptyState icon={<BookOpen size={20} />} title="No knowledge items yet" description="Add what the receptionist may promise, what it must never say, and the details that make answers accurate." action={<button type="button" onClick={() => setAdding(true)} className={buttonClass('primary', 'sm')}><Plus size={14} />Add the first rule</button>} /> : (
        <ul className="divide-y divide-[var(--line)]">{items.map((item) => editingId === item.id ? <li key={item.id} className="bg-[var(--bg-raised)] p-5"><KnowledgeForm tenantId={tenantId} item={item} onDone={() => setEditingId(null)} /></li> : <li key={item.id} className="px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><Badge tone="neutral">{item.category}</Badge><h3 className="text-[13px] font-semibold">{item.title}</h3><span className="text-[11px] tabular-nums text-[var(--muted)]">Priority {item.priority}</span></div><p className="mt-2 whitespace-pre-wrap text-[12px] leading-6 text-[var(--text-secondary)]">{item.content}</p></div>
            <div className="flex shrink-0 items-center gap-1">
              <button type="button" onClick={() => { setEditingId(item.id); setAdding(false); }} aria-label={`Edit ${item.title}`} className={buttonClass('ghost', 'sm', 'icon-button')}><Pencil size={14} /></button>
              <form action={deleteKnowledgeAction}><input type="hidden" name="itemId" value={item.id} /><input type="hidden" name="tenantId" value={tenantId} /><button type="submit" aria-label={`Delete ${item.title}`} className={buttonClass('ghost', 'sm', 'icon-button hover:text-[var(--danger)]')}><Trash2 size={14} /></button></form>
            </div>
          </div>
        </li>)}</ul>
      )}
    </Card>
  );
}
