import { redirect } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { getSession } from '@/lib/auth/session';
import { BrandLockup } from '@/components/ui/BrandMark';
import { Card } from '@/components/ui/core';
import { PasswordForm } from './PasswordForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Secure your account' };

export default async function InitialPasswordPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!session.mustChangePassword) redirect(session.isAgency ? '/agency' : '/portal');
  return <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-5 py-12">
    <div className="mb-8"><BrandLockup eyebrow="Your private workspace" /></div>
    <Card className="p-6 sm:p-8"><ShieldCheck size={26} className="mb-5 text-[var(--accent-primary)]" aria-hidden />
      <h1 className="page-title">Make it yours.</h1>
      <p className="page-description mb-7">Replace your temporary password before entering your workspace. Your agency cannot see the new password.</p>
      <PasswordForm />
    </Card>
  </main>;
}
