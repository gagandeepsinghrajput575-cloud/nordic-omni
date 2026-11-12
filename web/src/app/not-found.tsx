import Link from 'next/link';
import { ArrowLeft, SearchX } from 'lucide-react';
import { BrandLockup } from '@/components/ui/BrandMark';
import { buttonClass } from '@/components/ui/form';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6 py-12">
      <div className="mb-12"><BrandLockup eyebrow="Workspace" /></div>
      <SearchX size={28} strokeWidth={1.5} className="mb-5 text-[var(--muted)]" aria-hidden />
      <h1 className="page-title">This page isn’t available</h1>
      <p className="page-description">The link may have changed, or this customer or workspace no longer exists. Check the address and try again.</p>
      <div className="mt-7"><Link href="/" className={buttonClass('primary')}><ArrowLeft size={15} />Back to Nordic Omni</Link></div>
    </main>
  );
}
