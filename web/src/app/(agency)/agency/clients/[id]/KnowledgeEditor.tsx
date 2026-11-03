'use client';

import { useState } from 'react';
import { BookOpen, Pencil, Plus, Trash2, X } from 'lucide-react';
import { deleteKnowledgeAction } from './knowledge-actions';
import { Badge, Card, CardHeader } from '@/components/ui/core';
import { buttonClass } from '@/components/ui/form';
import { EmptyState } from '@/components/ui/feedback';
import { KnowledgeForm, type KnowledgeItemRow } from './KnowledgeForm';

export function KnowledgeEditor({
  tenantId,
  items,
}: {
  tenantId: string;
  items: KnowledgeItemRow[];
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader
        title="Knowledge"
        hint="Rules the agent may cite. Behaviour, so only the agency can write it."
        action={
          <div className="flex items-center gap-2">
            <Badge tone="neutral">{items.length}</Badge>
            <button
              type="button"
              onClick={() => {
                setAdding((v) => !v);
                setEditingId(null);
              }}
              className={buttonClass('secondary', 'sm')}
            >
              {adding ? <X size={11} /> : <Plus size={11} />}
              {adding ? 'Cancel' : 'Add'}
            </button>
          </div>
        }
      />

      {adding ? (
        <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-ground)] p-5">
          <KnowledgeForm tenantId={tenantId} onDone={() => setAdding(false)} />
        </div>
      ) : null}

      {items.length === 0 && !adding ? (
        <EmptyState
          icon={<BookOpen size={18} />}
          title="No knowledge items"
          description="Add the rules the agent must follow: what it may promise, what it must never say, and how your trade actually works."
          action={
            <button
              type="button"
              onClick={() => setAdding(true)}
              className={buttonClass('primary', 'sm')}
            >
              <Plus size={12} />
              Add the first rule
            </button>
          }
        />
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {items.map((item) =>
            editingId === item.id ? (
              <li key={item.id} className="bg-[var(--bg-ground)] p-5">
                <KnowledgeForm
                  tenantId={tenantId}
                  item={item}
                  onDone={() => setEditingId(null)}
                />
              </li>
            ) : (
              <li key={item.id} className="group px-5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="neutral">{item.category}</Badge>
                      <span className="text-xs font-medium text-[var(--text-primary)]">
                        {item.title}
                      </span>
                      <span className="font-mono text-[9px] text-[var(--text-muted)]">
                        p{item.priority}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                      {item.content}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(item.id);
                        setAdding(false);
                      }}
                      aria-label={`Edit ${item.title}`}
                      className="rounded-[var(--r-sm)] p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
                    >
                      <Pencil size={12} />
                    </button>
                    <form action={deleteKnowledgeAction}>
                      <input type="hidden" name="itemId" value={item.id} />
                      <input type="hidden" name="tenantId" value={tenantId} />
                      <button
                        type="submit"
                        aria-label={`Delete ${item.title}`}
                        className="rounded-[var(--r-sm)] p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                      >
                        <Trash2 size={12} />
                      </button>
                    </form>
                  </div>
                </div>
              </li>
            )
          )}
        </ul>
      )}
    </Card>
  );
}
