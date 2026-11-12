'use client';

import { AlertCircle, RotateCcw } from 'lucide-react';
import { BrandLockup } from '@/components/ui/BrandMark';
import { buttonClass } from '@/components/ui/form';
import { ThemeSwitcher } from '@/components/theme/ThemeSwitcher';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6 py-12">
      <div className="mb-12 flex items-center justify-between"><BrandLockup eyebrow="Workspace" /><ThemeSwitcher /></div>
      <AlertCircle size={28} strokeWidth={1.5} className="mb-5 text-[var(--danger)]" aria-hidden />
      <h1 className="page-title">We couldn’t load this page</h1>
      <p className="page-description">The workspace may be temporarily unavailable. Your saved changes are safe. Try loading the page again.</p>
      <div className="mt-7"><button type="button" onClick={reset} className={buttonClass('primary')}><RotateCcw size={15} />Try again</button></div>
    </main>
  );
}
