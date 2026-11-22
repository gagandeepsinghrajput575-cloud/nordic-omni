'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, Copy, ExternalLink, Lock, RefreshCw, Send, Users } from 'lucide-react';
import { useLocale } from '@/lib/i18n/LocaleContext';
import { Badge, Card, CardHeader } from '@/components/ui/core';
import { buttonClass } from '@/components/ui/form';

interface ClientAccessCardProps {
  tenantName: string;
  tenantSlug: string;
  memberEmails: string[];
}

export function ClientAccessCard({
  tenantName,
  tenantSlug,
  memberEmails,
}: ClientAccessCardProps) {
  const { locale, dict } = useLocale();
  const t = dict.clientAccess;
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);

  const origin =
    typeof window !== 'undefined'
      ? window.location.origin
      : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const loginUrl = `${origin}/login`;
  const primaryEmail = memberEmails[0] ?? '';

  async function copy(text: string, onDone: (v: boolean) => void) {
    try {
      await navigator.clipboard.writeText(text);
      onDone(true);
      setTimeout(() => onDone(false), 2000);
    } catch {
      // Clipboard API unavailable in non-secure contexts.
    }
  }

  const inviteText =
    locale === 'da'
      ? `Hej! Din private kundeportal for ${tenantName} er klar.\n\nLog ind her: ${loginUrl}${primaryEmail ? `\nBrugernavn: ${primaryEmail}` : ''}\n\nHer kan du se dine kundehenvendelser, optagelser, priser og åbningstider i realtid.`
      : `Hi! Your private client portal for ${tenantName} is ready.\n\nSign in here: ${loginUrl}${primaryEmail ? `\nEmail: ${primaryEmail}` : ''}\n\nYou can view leads, call recordings, pricing, and opening hours in real time.`;

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={t.title}
        hint={t.hint}
        action={
          <Badge tone="success" dot>
            {t.liveSyncBadge}
          </Badge>
        }
      />

      <div className="space-y-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] p-3.5">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--muted)]">
              {t.portalUrlLabel}
            </p>
            <p className="mt-1 truncate font-mono text-[13px] text-[var(--text)]">
              {loginUrl}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => copy(loginUrl, setCopiedUrl)}
              className={buttonClass('secondary', 'sm')}
            >
              {copiedUrl ? <Check size={13} /> : <Copy size={13} />}
              <span>{copiedUrl ? t.copied : t.copyLink}</span>
            </button>
            <button
              type="button"
              onClick={() => copy(inviteText, setCopiedInvite)}
              className={buttonClass('primary', 'sm')}
            >
              {copiedInvite ? <Check size={13} /> : <Send size={13} />}
              <span>{copiedInvite ? t.copiedOnboardingMsg : t.copyOnboardingMsg}</span>
            </button>
            <Link
              href={`/showcase/${tenantSlug}`}
              target="_blank"
              className={buttonClass('ghost', 'sm')}
            >
              <ExternalLink size={13} />
              <span>{t.showcaseCta}</span>
            </Link>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] p-4">
            <div className="flex items-center gap-2 text-[12.5px] font-semibold text-[var(--text)]">
              <Lock size={14} className="shrink-0 text-[var(--muted)]" aria-hidden />
              <span>{t.isolationTitle}</span>
            </div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--text-secondary)]">
              {t.isolationBody}
            </p>
          </div>

          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] p-4">
            <div className="flex items-center gap-2 text-[12.5px] font-semibold text-[var(--text)]">
              <RefreshCw size={14} className="shrink-0 text-[var(--muted)]" aria-hidden />
              <span>{t.syncTitle}</span>
            </div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--text-secondary)]">
              {t.syncBody}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-4 text-[12px]">
          <span className="inline-flex items-center gap-1.5 font-medium text-[var(--muted)]">
            <Users size={13} aria-hidden />
            {t.assignedAccounts}:
          </span>
          {memberEmails.length > 0 ? (
            memberEmails.map((email) => (
              <Badge key={email} tone="neutral">
                {email}
              </Badge>
            ))
          ) : (
            <span className="text-[var(--text-secondary)]">{t.noAccountsYet}</span>
          )}
        </div>
      </div>
    </Card>
  );
}
