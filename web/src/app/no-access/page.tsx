import { Building2 } from 'lucide-react';
import { BrandLockup } from '@/components/ui/BrandMark';
import { LogoutButton } from '@/components/shell/LogoutButton';
import { ThemeSwitcher } from '@/components/theme/ThemeSwitcher';

export const metadata = { title: 'Workspace unavailable' };

export default function NoAccessPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6 py-12">
      <div className="mb-12 flex items-center justify-between"><BrandLockup eyebrow="Workspace" /><ThemeSwitcher /></div>
      <Building2 size={28} strokeWidth={1.5} className="mb-5 text-[var(--muted)]" aria-hidden />
      <h1 className="page-title">Workspace unavailable</h1>
      <p className="page-description">There is no active workspace available for this account. It may not have a workspace assignment, or access may be paused or suspended. Ask your agency administrator to review your access.</p>
      <div className="mt-7"><LogoutButton /></div>
    </main>
  );
}
