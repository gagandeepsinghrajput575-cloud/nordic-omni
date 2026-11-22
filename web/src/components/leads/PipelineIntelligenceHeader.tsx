'use client';

import React, { useState } from 'react';
import {
  Compass,
  TrendingUp,
  Sparkles,
  Camera,
  Star,
  Copy,
  Check,
  ExternalLink,
} from 'lucide-react';
import { StagePill } from '@/components/ui/core';

interface PipelineIntelligenceHeaderProps {
  stage: string;
  estimatedValueDkk: number;
  isDanish: boolean;
  customerName?: string | null;
  reviewUrl?: string;
  mediaUploadUrl?: string;
}

export function PipelineIntelligenceHeader({
  stage,
  estimatedValueDkk,
  isDanish,
  customerName,
  reviewUrl,
  mediaUploadUrl,
}: PipelineIntelligenceHeaderProps) {
  const [copiedType, setCopiedType] = useState<string | null>(null);

  const copyToClipboard = (text: string, type: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 2500);
    }
  };

  const getNextStepRecommendation = (stageKey: string): { title: string; detail: string; urgent: boolean } => {
    switch (stageKey) {
      case 'new_lead':
        return {
          title: isDanish ? 'Kvalificér kunde & omfang' : 'Qualify caller & project scope',
          detail: isDanish
            ? 'Ring kunden op inden for 15 minutter eller send foto-upload link for at vurdere opgaven.'
            : 'Call lead within 15 minutes or send photo upload link to evaluate project scope.',
          urgent: true,
        };
      case 'contacted':
        return {
          title: isDanish ? 'Indhent projektbilleder & mål' : 'Collect project photos & measurements',
          detail: isDanish
            ? 'Send foto-link til kunden via SMS for at få billeder af opgaven, så der kan laves et overslag.'
            : 'Send photo link via SMS so caller can provide project photos for estimating.',
          urgent: false,
        };
      case 'qualified':
        return {
          title: isDanish ? 'Aftal gratis besigtigelse' : 'Offer free site inspection',
          detail: isDanish
            ? 'Kunden er kvalificeret med overslag. Book et uforpligtende fysisk møde for at låse tilbuddet.'
            : 'Lead is qualified with estimate. Book an on-site inspection to lock binding quote.',
          urgent: false,
        };
      case 'booked':
        return {
          title: isDanish ? 'Gennemfør besigtigelse & fremsend tilbud' : 'Complete inspection & send binding quote',
          detail: isDanish
            ? 'Tjek kalenderaftale, forbered materialer og opret det endelige tilbud efter besigtigelsen.'
            : 'Review calendar booking, prepare materials, and send finalized quote post-inspection.',
          urgent: false,
        };
      case 'dire_escalated':
        return {
          title: isDanish ? 'Akut opkald nødvendigt!' : 'Immediate call required!',
          detail: isDanish
            ? 'Kunden har en hasteopgave eller anmodet om ejer/mester. Ring straks tilbage.'
            : 'Urgent caller emergency or direct human request. Call back immediately.',
          urgent: true,
        };
      case 'closed_won':
        return {
          title: isDanish ? 'Job vundet · Indhent Google Anmeldelse' : 'Job won · Request Google Review',
          detail: isDanish
            ? 'Send det smarte review-link til kunden. Positiv feedback guides til Google, lav feedback logges internt.'
            : 'Send smart review link. Positive ratings direct to Google, complaints stay internal.',
          urgent: false,
        };
      case 'closed_lost':
        return {
          title: isDanish ? 'Opfølgning om 30 dage' : 'Follow up in 30 days',
          detail: isDanish
            ? 'Sagen er tabt for nu. Sæt en påmindelse om at følge op om 30 dage.'
            : 'Case is closed lost. Set reminder to touch base in 30 days.',
          urgent: false,
        };
      default:
        return {
          title: isDanish ? 'Følg op på kunden' : 'Follow up with lead',
          detail: isDanish ? 'Gennemgå samtalelog og afklar næste skridt.' : 'Review call log and clarify next steps.',
          urgent: false,
        };
    }
  };

  const rec = getNextStepRecommendation(stage);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-blue-500/20 bg-gradient-to-r from-slate-900 via-blue-950/20 to-slate-900 p-5 shadow-lg">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        {/* Left side: Stage + Current Status */}
        <div className="flex items-start gap-4">
          <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 mt-0.5">
            <Compass className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wider font-semibold text-blue-400">
                {isDanish ? 'Pipeline Intelligence' : 'Pipeline Intelligence'}
              </span>
              <span className="text-slate-600">•</span>
              <StagePill stage={stage} danish={isDanish} />
            </div>
            <h2 className="text-lg font-bold text-white mt-1">
              {customerName ? `${customerName} · ` : ''}
              {rec.title}
            </h2>
            <p className="text-sm text-slate-300 mt-0.5 leading-relaxed max-w-2xl">
              {rec.detail}
            </p>
          </div>
        </div>

        {/* Right side: Estimated Value & Smart Action Shortcuts */}
        <div className="flex flex-wrap items-center gap-3 border-t border-slate-800 pt-3 lg:border-t-0 lg:pt-0">
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl px-4 py-2 text-right">
            <div className="text-[11px] text-slate-400 flex items-center justify-end gap-1">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              <span>{isDanish ? 'Vejledende værdi' : 'Estimated Value'}</span>
            </div>
            <div className="text-base font-semibold text-white tabular-nums">
              {estimatedValueDkk > 0
                ? `${estimatedValueDkk.toLocaleString(isDanish ? 'da-DK' : 'en-GB')} DKK`
                : isDanish
                  ? 'Ikke estimeret'
                  : 'Not estimated'}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {mediaUploadUrl && (
              <button
                type="button"
                onClick={() => copyToClipboard(mediaUploadUrl, 'media')}
                className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 flex items-center gap-1.5 transition-all shadow-sm"
                title={isDanish ? 'Kopiér link til foto-upload' : 'Copy photo upload link'}
              >
                {copiedType === 'media' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Camera className="w-3.5 h-3.5 text-blue-400" />
                )}
                <span>{copiedType === 'media' ? (isDanish ? 'Kopieret!' : 'Copied!') : (isDanish ? 'Foto-link' : 'Photo link')}</span>
              </button>
            )}

            {reviewUrl && (
              <button
                type="button"
                onClick={() => copyToClipboard(reviewUrl, 'review')}
                className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium flex items-center gap-1.5 transition-all shadow-sm shadow-blue-600/20"
                title={isDanish ? 'Kopiér Google Review Gatekeeper link' : 'Copy Google Review link'}
              >
                {copiedType === 'review' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-300" />
                ) : (
                  <Star className="w-3.5 h-3.5 fill-white text-white" />
                )}
                <span>{copiedType === 'review' ? (isDanish ? 'Kopieret!' : 'Copied!') : (isDanish ? 'Review-link' : 'Review link')}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
