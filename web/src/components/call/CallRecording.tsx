import { AlertTriangle, CheckCircle2, MinusCircle } from 'lucide-react';
import { Badge, Card, CardHeader } from '@/components/ui/core';
import type { CallLogRow } from '@/lib/db/queries';

/** A finished call: audio and transcript. A missing recording is always visible. */
const ROLE_DA: Record<string, string> = { assistant: 'AI', agent: 'AI', ai: 'AI', user: 'Kunde', customer: 'Kunde', caller: 'Kunde', owner: 'Ejer', system: 'System' };
const ROLE_EN: Record<string, string> = { assistant: 'AI', agent: 'AI', ai: 'AI', user: 'Caller', customer: 'Caller', caller: 'Caller', owner: 'Owner', system: 'System' };

function normaliseTurns(raw: unknown): Array<{ role: string; content: string }> {
  if (!Array.isArray(raw)) return [];
  return raw.map((turn) => {
    const record = turn as Record<string, unknown>;
    return { role: String(record?.role ?? record?.speaker ?? 'unknown'), content: String(record?.content ?? record?.text ?? '') };
  }).filter((turn) => turn.content.trim().length > 0);
}
function clock(totalSeconds: number) { return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`; }

export function CallRecording({ call, isDanish, index, total }: { call: CallLogRow; isDanish: boolean; index: number; total: number }) {
  const t = (da: string, en: string) => isDanish ? da : en;
  const roles = isDanish ? ROLE_DA : ROLE_EN;
  const turns = normaliseTurns(call.transcript_full);
  const when = new Date(call.created_at).toLocaleString(isDanish ? 'da-DK' : 'en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const status = call.recording_status === 'ok' ? <Badge tone="success" dot>{t('Optagelse', 'Recording')}</Badge> : call.recording_status === 'failed' ? <Badge tone="danger" dot>{t('Optagelse fejlede', 'Recording failed')}</Badge> : call.recording_status === 'skipped' ? <Badge tone="neutral">{t('Ikke optaget', 'Not recorded')}</Badge> : <Badge tone="warning">{t('Ikke forsøgt', 'Not attempted')}</Badge>;

  return (
    <Card>
      <CardHeader title={`${t('Opkald', 'Call')} ${total - index} · ${when}`} hint={`${t('Varighed', 'Duration')}: ${call.duration_seconds > 0 ? clock(call.duration_seconds) : t('Ukendt', 'Unknown')}`} action={status} />
      <div className="space-y-4 p-5">
        {call.recording_status === 'ok' && call.recording_url ? <div className="space-y-1.5"><audio controls preload="metadata" src={call.recording_url} className="w-full" aria-label={t('Lydoptagelse af opkaldet', 'Audio recording of the call')} />{call.recording_bytes ? <p className="text-[11px] tabular-nums text-[var(--muted)]">{(call.recording_bytes / 1024).toFixed(0)} KB · Ogg Opus</p> : null}</div> : null}
        {call.recording_status === 'failed' ? <div className="notice notice-danger"><AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden /><div className="min-w-0"><p className="text-[12px] font-medium">{t('Optagelse fejlede', 'Recording failed')}</p>{call.recording_error ? <p className="mt-1 break-words font-mono text-[11px] opacity-90">{call.recording_error}</p> : null}</div></div> : null}
        {turns.length === 0 ? <p className="flex items-center gap-2 text-[12px] text-[var(--muted)]"><MinusCircle size={13} aria-hidden />{t('Ingen samtale gemt for dette opkald.', 'No conversation stored for this call.')}</p> : <div><p className="mb-3 flex items-center gap-2 text-[12px] font-medium text-[var(--text-secondary)]"><CheckCircle2 size={13} className="text-[var(--success)]" aria-hidden />{t('Samtale', 'Conversation')} · {turns.length} {t('ture', 'turns')}</p><ul className="space-y-2.5">{turns.map((turn, turnIndex) => { const isAgent = ['assistant', 'agent', 'ai'].includes(turn.role); return <li key={turnIndex} className={isAgent ? 'flex justify-start' : 'flex justify-end'}><div className={`chat-bubble ${isAgent ? 'chat-bubble-ai' : 'chat-bubble-customer'}`}><p className="mb-1 text-[11px] font-medium text-[var(--muted)]">{roles[turn.role] ?? turn.role}</p><p className="whitespace-pre-wrap">{turn.content}</p></div></li>; })}</ul></div>}
      </div>
    </Card>
  );
}
