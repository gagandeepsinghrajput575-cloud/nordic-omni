import type { Metadata } from 'next';
import { WelcomeNavigation } from '@/components/welcome/WelcomeNavigation';
import { HeroSection } from '@/components/welcome/HeroSection';
import { BentoGrid } from '@/components/welcome/BentoGrid';
import { ConversationalPlatformSection } from '@/components/welcome/ConversationalPlatformSection';
import { DeveloperSection } from '@/components/welcome/DeveloperSection';
import { EnterpriseSecuritySection } from '@/components/welcome/EnterpriseSecuritySection';
import { WelcomeFooter } from '@/components/welcome/WelcomeFooter';

/**
 * The public welcome route.
 *
 * Deliberately outside the `(agency)` and `portal` groups: no session read, no
 * redirect, no shell. The reference is a marketing surface, and mounting it on
 * the root route would have meant replacing the login entry point.
 *
 * Assembly order is the page: nav, hero, bento, conversational, developer,
 * security, footer. The nav is fixed, so `.welcome-shell` reserves its height
 * via `--wnav-h` rather than the hero guessing a padding.
 */

export const metadata: Metadata = {
  title: 'Nordic Omni · Bringing technology to life',
  description:
    'Den danske AI-telefonreception: kundesamtaler, booking og leads — døgnet rundt.',
};

export default function WelcomePage() {
  return (
    <>
      <WelcomeNavigation />
      <main className="welcome-shell">
        <HeroSection />
        <BentoGrid />
        <ConversationalPlatformSection />
        <DeveloperSection />
        <EnterpriseSecuritySection />
        <WelcomeFooter />
      </main>
    </>
  );
}
