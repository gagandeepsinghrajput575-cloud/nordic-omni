'use client';

import { useActionState, useState } from 'react';
import { Archive } from 'lucide-react';
import { updateCallerAction, closeCallerAction } from '@/app/(client)/portal/leads/actions';
import { EMPTY_STATE } from '@/lib/actions/types';
import { STAGES } from '@/lib/pipeline';
import { Card, CardHeader } from '@/components/ui/core';
import { Field, Input, Select, Textarea, FormAlert, buttonClass } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { Dialog } from '@/components/ui/Dialog';

export function LeadDetailForm({ contactId, isDanish, defaultStage, defaultScore, defaultValue, defaultSummary, autoReply }: {
  contactId: string; isDanish: boolean; defaultStage: string; defaultScore: number; defaultValue: number; defaultSummary: string; autoReply: boolean;
}) {
  const [state, formAction] = useActionState(updateCallerAction, EMPTY_STATE);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const t = (da: string, en: string) => isDanish ? da : en;
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title={t('Pipeline og kontekst', 'Pipeline and context')} hint={t('Flyt kunden, og justér hvad sagen er værd.', 'Move the caller and adjust what the case is worth.')} />
        <form action={formAction}>
          <div className="space-y-5 p-5">
            <input type="hidden" name="contactId" value={contactId} />
            {state.error ? <FormAlert tone="error">{state.error}</FormAlert> : null}
            {state.ok && state.message ? <FormAlert tone="success">{state.message}</FormAlert> : null}
            <Field htmlFor="pipelineStage" label={t('Stadie', 'Stage')}><Select id="pipelineStage" name="pipelineStage" defaultValue={defaultStage}>{STAGES.map(([value, da, en]) => <option key={value} value={value}>{t(da, en)}</option>)}</Select></Field>
            <div className="grid grid-cols-2 gap-4">
              <Field htmlFor="leadScore" label={t('Kundescore', 'Lead score')} hint="0–100"><Input id="leadScore" name="leadScore" type="number" min={0} max={100} defaultValue={defaultScore} /></Field>
              <Field htmlFor="estimatedValueDkk" label={t('Værdi', 'Value')} hint="DKK"><Input id="estimatedValueDkk" name="estimatedValueDkk" type="number" min={0} step={100} defaultValue={defaultValue} /></Field>
            </div>
            <Field htmlFor="summary" label={t('Hvad ved vi', 'What we know')} hint={t('Læses af AI’en før næste opkald', 'Read by the AI before the next call')}><Textarea id="summary" name="summary" rows={5} defaultValue={defaultSummary} /></Field>
            <label className="surface-raised flex cursor-pointer items-start gap-3 p-4"><input type="checkbox" name="aiAutoReplyEnabled" defaultChecked={autoReply} className="mt-0.5" /><span className="text-[12px] leading-5 text-[var(--text-secondary)]"><span className="block font-medium text-[var(--text)]">{t('AI må svare denne kunde', 'AI may reply to this caller')}</span>{t('Slå fra, når du selv tager over. Så holder AI’en sig væk.', 'Turn off when you take over yourself. The AI then stays out of the way.')}</span></label>
          </div>
          <div className="form-footer"><SubmitButton pendingLabel={t('Gemmer…', 'Saving…')}>{t('Gem ændringer', 'Save changes')}</SubmitButton></div>
        </form>
      </Card>
      <Card className="p-5">
        <div className="flex items-start gap-3"><Archive size={17} className="mt-0.5 shrink-0 text-[var(--muted)]" aria-hidden /><div className="min-w-0 flex-1"><h3 className="text-[13px] font-medium">{t('Arkivér kunden', 'Archive this caller')}</h3><p className="mt-1 text-[12px] leading-5 text-[var(--muted)]">{t('Sætter kunden til “tabt”. Sletning af kundedata er en bureau-handling.', 'Moves them to “closed lost”. Deleting caller data is an agency action.')}</p><button type="button" onClick={() => setArchiveOpen(true)} className={buttonClass('secondary', 'sm', 'mt-3')}>{t('Arkivér', 'Archive')}</button></div></div>
      </Card>
      <Dialog open={archiveOpen} onClose={() => setArchiveOpen(false)} title={t('Arkivér kunde?', 'Archive caller?')} description={t('Kunden flyttes til “tabt”. Du kan ændre stadiet igen senere.', 'The caller moves to “closed lost”. You can change the stage again later.')} footer={<><button type="button" onClick={() => setArchiveOpen(false)} className={buttonClass('ghost')}>{t('Annuller', 'Cancel')}</button><form action={closeCallerAction}><input type="hidden" name="contactId" value={contactId} /><SubmitButton variant="danger" pendingLabel={t('Arkiverer…', 'Archiving…')}>{t('Arkivér kunde', 'Archive caller')}</SubmitButton></form></>}>
        <p className="text-[13px] leading-6 text-[var(--text-secondary)]">{t('Dette sletter ikke kundens data. Det markerer blot sagen som afsluttet i pipelinen.', 'This does not delete the caller’s data. It only marks the case as closed in the pipeline.')}</p>
      </Dialog>
    </div>
  );
}
