import { AlertTriangle, CheckCircle2, MinusCircle } from 'lucide-react';
import { Badge, Card, CardHeader } from '@/components/ui/core';
import type { CallLogRow } from '@/lib/db/queries';

/**
 * A finished call: the audio and what was said, side by side.
 *
 * The point of the status badge is that a missing recording is VISIBLE. The
 * previous recorder in this repo failed silently for months, so "ok" is earned
 * by a verified file, and anything else says so in red.
 */

const ROLE_LABEL: Record<string, string> = {
  assistant: 'AI',
  agent: 'AI',
  ai: 'AI',
  user: 'Kunde',
  customer: 'Kunde',
  caller: 'Kunde',
  owner: 'Ejer',
  system: 'System',
};

const EMPTY_DANISH = {
  ok: 'Optagelse',
  failed: 'Optagelse fejlede',
  skipped: 'Ikke optaget',
  notAttempted: 'Ikke forsøgt',
  transcript: 'Samtale',
  noTranscript: 'Ingen samtale gemt for dette opkald.',
  duration: 'Varighed',
  unknown: 'Ukendt',
};

const EMPTY_ENGLISH = {
  ok: 'Recording',
  failed: 'Recording failed',
  skipped: 'Not recorded',
  notAttempted: 'Not attempted',
  transcript: 'Conversation',
  noTranscript: 'No conversation stored for this call.',
  duration: 'Duration',
  unknown: 'Unknown',
};

/**
 * Normalise a stored transcript.
 *
 * Two shapes exist in this database: the worker writes {role, content}, while the
 * original seed wrote {speaker, text}. Both are legitimate history, so the view
 * accepts either rather than rendering empty bubbles for older calls.
 */
function normaliseTurns(raw: unknown): Array<{ role: string; content: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((turn) => {
      const record = turn as Record<string, unknown>;
      return {
        role: String(record?.role ?? record?.speaker ?? 'unknown'),
        content: String(record?.content ?? record?.text ?? ''),
      };
    })
    .filter((turn) => turn.content.trim().length > 0);
}

function clock(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function CallRecording({
  call,
  isDanish,
  index,
  total,
}: {
  call: CallLogRow;
  isDanish: boolean;
  index: number;
  total: number;
}) {
  const t = isDanish ? EMPTY_DANISH : EMPTY_ENGLISH;
  const turns = normaliseTurns(call.transcript_full);
  const when = new Date(call.created_at).toLocaleString(isDanish ? 'da-DK' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Card>
      <CardHeader
        title={`${isDanish ? 'Opkald' : 'Call'} ${total - index} · ${when}`}
        hint={`${t.duration}: ${call.duration_seconds > 0 ? clock(call.duration_seconds) : t.unknown}`}
        action={
          <div className="flex items-center gap-2">
            {call.recording_status === 'ok' ? (
              <Badge tone="success" dot>
                {t.ok}
              </Badge>
            ) : null}
            {call.recording_status === 'failed' ? (
              <Badge tone="danger" dot>
                {t.failed}
              </Badge>
            ) : null}
            {call.recording_status === 'skipped' ? (
              <Badge tone="neutral">{t.skipped}</Badge>
            ) : null}
            {/* NULL is not "failed" — it means the call predates recording, or the
                worker never reached the shutdown hook. Saying "failed" there would
                be a different lie. */}
            {call.recording_status == null ? (
              <Badge tone="warning">{t.notAttempted}</Badge>
            ) : null}
          </div>
        }
      />

      <div className="space-y-4 p-5">
        {/* Audio, when it exists. */}
        {call.recording_status === 'ok' && call.recording_url ? (
          <div className="space-y-1.5">
            <audio
              controls
              preload="none"
              src={call.recording_url}
              className="w-full"
              aria-label={isDanish ? 'Lydoptagelse af opkaldet' : 'Audio recording of the call'}
            />
            {call.recording_bytes ? (
              <p className="font-mono text-[10px] text-[var(--text-muted)]">
                {(call.recording_bytes / 1024).toFixed(0)} KB · Ogg Opus
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Failure is never silent. */}
        {call.recording_status === 'failed' ? (
          <div className="flex items-start gap-2 rounded-[var(--r-sm)] border border-[var(--danger)]/40 bg-[var(--danger-soft)] px-3 py-2">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-[var(--danger)]" />
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-[var(--danger)]">{t.failed}</p>
              {call.recording_error ? (
                <p className="mt-0.5 break-words font-mono text-[10px] text-[var(--danger)]/80">
                  {call.recording_error}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Transcript. */}
        {turns.length === 0 ? (
          <p className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
            <MinusCircle size={12} />
            {t.noTranscript}
          </p>
        ) : (
          <div>
            <p className="text-eyebrow mb-2 flex items-center gap-1.5">
              <CheckCircle2 size={11} className="text-[var(--success)]" />
              {t.transcript} · {turns.length} {isDanish ? 'ture' : 'turns'}
            </p>
            <ul className="space-y-2">
              {turns.map((turn, i) => {
                // The worker writes "assistant"; the older seed wrote "agent".
                // Both mean the AI spoke, so both sit on the left.
                const isAgent = ['assistant', 'agent', 'ai'].includes(turn.role);
                return (
                  <li key={i} className={isAgent ? 'flex justify-start' : 'flex justify-end'}>
                    <div
                      className={
                        isAgent
                          ? 'max-w-[85%] rounded-[var(--r-md)] rounded-bl-sm border border-[var(--border-subtle)] bg-[var(--bg-raised)] px-3 py-2'
                          : 'max-w-[85%] rounded-[var(--r-md)] rounded-br-sm bg-[var(--accent-soft)] px-3 py-2'
                      }
                    >
                      <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
                        {(isDanish ? ROLE_LABEL[turn.role] : undefined) ??
                          ROLE_LABEL[turn.role] ??
                          turn.role}
                      </div>
                      <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--text-primary)]">
                        {turn.content}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
