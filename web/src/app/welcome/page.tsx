import type { Metadata } from 'next';
import { HeroSection } from '@/components/welcome/HeroSection';

/**
 * The public welcome route.
 *
 * Deliberately outside the `(agency)` and `portal` groups: no session read, no
 * redirect, no shell. The reference is a marketing surface, and mounting it on
 * the root route would have meant replacing the login entry point.
 */

export const metadata: Metadata = {
  title: 'Nordic Omni · Bringing technology to life',
  description:
    'Den danske AI-telefonreception: kundesamtaler, booking og leads — døgnet rundt.',
};

export default function WelcomePage() {
  return (
    <main className="welcome-shell">
      <HeroSection />
    </main>
  );
}
