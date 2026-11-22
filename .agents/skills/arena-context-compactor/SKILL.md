---
name: arena-context-compactor
description: Context compaction, state preservation, and token pruning protocol for LM Arena (arena.ai) and long-context agents. Use when a chat session reaches 5+ turns, experiences token bloat, or receives [COMPACT], [PURGE], or /compact triggers.
---

# LM Arena Context Compactor & Memory Ledger

Use this skill whenever an LM Arena agent session reaches 5+ turns, accumulates large bash/test logs, or receives the trigger `[COMPACT]`, `[PURGE]`, or `/compact`.

---

## 1. The Core Objective
Prune conversational and tool token bloat while preserving 100% of architectural state, test status, and pending tasks. Free up the model's active attention window so reasoning remains rapid and hallucination-free.

---

## 2. Compaction Execution Protocol (When Triggered)

When `[COMPACT]` or `/compact` is requested, the agent must execute these 3 steps immediately:

### Step 1: Memory Pruning (Drop Dead Context)
- Drop all intermediate terminal logs, full stack traces, and verbose JSON outputs from working memory.
- Cease referencing previous failed attempts or speculative syntax errors.
- Do not re-print large file listings or entire source files.

### Step 2: State Ledger Synthesis
Emit a concise, structured **State Ledger** in the exact format below:

```markdown
### ⚡ Arena Session State Ledger
- **Active Task**: [Current objective]
- **Git Branch / Commit**: [e.g., main @ 2cfbc3c]
- **Verification Status**: [e.g., 234/234 tests passing | tsc clean]
- **Modified / Created Files**:
  - `path/to/file1.ts` (what changed)
  - `path/to/file2.ts` (what changed)
- **Active Drive Skills**: [e.g., CHIEF_SOFTWARE_ENGINEER_CHECKLIST.md, frontend-ui-master.md]
- **Next 3 Immediate Actions**:
  1. [Action 1]
  2. [Action 2]
  3. [Action 3]
```

### Step 3: Sync to Google Drive (Optional Persistence)
If Google Drive integration is active:
- Update or write `skillgods/STATE.md` with the State Ledger above.
- This allows a fresh Arena session or partner agent to pick up immediately without reading previous chat turns.

---

## 3. Mid-Turn Auto-Condenser Rule
To prevent context bloat before it happens:
- After every successful test run or file commit, end the turn with a 2-line mini status:
  `STATUS: [Target] verified | 234 tests passing | Next: [Next Target]`
- Never dump terminal outputs exceeding 15 lines. Always use `head`, `tail`, or grep for relevant lines.
