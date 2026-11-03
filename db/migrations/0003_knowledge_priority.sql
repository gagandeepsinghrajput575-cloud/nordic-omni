-- 0003 — knowledge ordering.
--
-- knowledge_items had no way to express which rule matters most, so the worker
-- ordered by category/title and a critical rule could sit below a trivial one.
-- The agency console exposes a priority field; this is the column behind it.
--
-- Default 50 keeps every existing row valid and mid-weight, so nothing silently
-- jumps to the top of the prompt.

BEGIN;

ALTER TABLE knowledge_items
    ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 50
    CHECK (priority >= 0 AND priority <= 100);

-- The worker reads active items for one tenant, highest priority first.
CREATE INDEX IF NOT EXISTS knowledge_items_tenant_priority_idx
    ON knowledge_items (tenant_id, priority DESC)
    WHERE is_active;

COMMIT;
