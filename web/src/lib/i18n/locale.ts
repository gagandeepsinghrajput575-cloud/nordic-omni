export type AppLocale = 'en' | 'da';

export const LOCALE_COOKIE = 'omni_locale';

export function normalizeLocale(value: string | null | undefined, fallback: AppLocale = 'en'): AppLocale {
  if (!value) return fallback;
  const lower = value.trim().toLowerCase();
  if (lower === 'da' || lower.startsWith('da-')) return 'da';
  if (lower === 'en' || lower.startsWith('en-')) return 'en';
  return fallback;
}

export interface UiDictionary {
  shell: {
    skipToContent: string;
    brandTagline: string;
    management: string;
    workspace: string;
    agencyEyebrow: string;
    agencyConsole: string;
    agencyAdmin: string;
    clientEyebrow: string;
    browserCallsOnly: string;
    openNav: string;
    closeNav: string;
    signOut: string;
  };
  agencyNav: {
    portfolio: string;
    workforce: string;
    clients: string;
    webhooks: string;
  };
  portalNav: {
    overview: string;
    callers: string;
    messages: string;
    settings: string;
  };
  login: {
    eyebrow: string;
    heroTitleLine1: string;
    heroTitleLine2: string;
    heroBody: string;
    readyNote: string;
    welcomeBack: string;
    subtitle: string;
    emailLabel: string;
    passwordLabel: string;
    passwordPlaceholder: string;
    signInCta: string;
    signingIn: string;
    footerNote: string;
    roleNote: string;
  };
  clientAccess: {
    title: string;
    hint: string;
    liveSyncBadge: string;
    portalUrlLabel: string;
    copyLink: string;
    copied: string;
    copyOnboardingMsg: string;
    copiedOnboardingMsg: string;
    assignedAccounts: string;
    noAccountsYet: string;
    isolationTitle: string;
    isolationBody: string;
    syncTitle: string;
    syncBody: string;
    showcaseCta: string;
  };
}

export const DICTIONARY: Record<AppLocale, UiDictionary> = {
  en: {
    shell: {
      skipToContent: 'Skip to content',
      brandTagline: 'Voice-led business',
      management: 'Management',
      workspace: 'Workspace',
      agencyEyebrow: 'Agency',
      agencyConsole: 'Agency console',
      agencyAdmin: 'Agency administrator',
      clientEyebrow: 'Workspace',
      browserCallsOnly: 'Browser calls only',
      openNav: 'Open navigation',
      closeNav: 'Close navigation',
      signOut: 'Sign out',
    },
    agencyNav: {
      portfolio: 'Portfolio',
      workforce: 'AI Workforce',
      clients: 'Clients',
      webhooks: 'Webhook hub',
    },
    portalNav: {
      overview: 'Overview',
      callers: 'Callers',
      messages: 'Messages',
      settings: 'Settings',
    },
    login: {
      eyebrow: 'Voice-led customer operations',
      heroTitleLine1: 'Good conversations.',
      heroTitleLine2: 'Great business.',
      heroBody:
        'Your AI receptionist, customer conversations and everyday operations. Together in one calm workspace.',
      readyNote: 'Your workspace, ready when you are.',
      welcomeBack: 'Welcome back',
      subtitle: 'Sign in with your assigned email and password.',
      emailLabel: 'Email address',
      passwordLabel: 'Password',
      passwordPlaceholder: 'Enter your password',
      signInCta: 'Sign in to workspace',
      signingIn: 'Opening your workspace…',
      footerNote: 'Nordic Omni · Voice, chat and customer operations',
      roleNote: 'Clients are routed straight to their private portal. Agency staff open the agency console.',
    },
    clientAccess: {
      title: 'Client portal handoff & live sync',
      hint: 'Give your client their login credentials — they only ever see their own private portal.',
      liveSyncBadge: 'Live RLS Sync',
      portalUrlLabel: 'Client sign-in URL',
      copyLink: 'Copy login URL',
      copied: 'Copied',
      copyOnboardingMsg: 'Copy invite text',
      copiedOnboardingMsg: 'Invite copied',
      assignedAccounts: 'Assigned client login(s)',
      noAccountsYet: 'No client user created yet — add one under the Team tab.',
      isolationTitle: 'Strict separation',
      isolationBody:
        'Signing in with a client email routes straight to /portal. Visiting /agency is automatically blocked and redirected back to /portal.',
      syncTitle: 'Real-time agency visibility',
      syncBody:
        'Both screens share the same RLS-scoped PostgreSQL workspace. Any hours, pricing, lead stage, or chat update the client makes appears here immediately.',
      showcaseCta: 'Open voice demo',
    },
  },
  da: {
    shell: {
      skipToContent: 'Spring til indhold',
      brandTagline: 'Stemmestyret kundeservice',
      management: 'Administration',
      workspace: 'Arbejdsrum',
      agencyEyebrow: 'Bureau',
      agencyConsole: 'Bureaukonsol',
      agencyAdmin: 'Bureauadministrator',
      clientEyebrow: 'Arbejdsrum',
      browserCallsOnly: 'Kun browseropkald',
      openNav: 'Åbn navigation',
      closeNav: 'Luk navigation',
      signOut: 'Log ud',
    },
    agencyNav: {
      portfolio: 'Portefølje',
      workforce: 'AI-medarbejdere',
      clients: 'Kunder',
      webhooks: 'Webhook-hub',
    },
    portalNav: {
      overview: 'Overblik',
      callers: 'Kunder',
      messages: 'Beskeder',
      settings: 'Indstillinger',
    },
    login: {
      eyebrow: 'Stemmestyret kundemodtagelse',
      heroTitleLine1: 'Gode samtaler.',
      heroTitleLine2: 'Stærk forretning.',
      heroBody:
        'Din AI-receptionist, kundesamtaler og daglige drift samlet i ét roligt arbejdsrum.',
      readyNote: 'Dit arbejdsrum er klar, når du er.',
      welcomeBack: 'Velkommen tilbage',
      subtitle: 'Log ind med den e-mail og adgangskode, du har fået tildelt.',
      emailLabel: 'E-mailadresse',
      passwordLabel: 'Adgangskode',
      passwordPlaceholder: 'Indtast din adgangskode',
      signInCta: 'Log ind i arbejdsrum',
      signingIn: 'Åbner dit arbejdsrum…',
      footerNote: 'Nordic Omni · Telefoni, chat og kundestyring',
      roleNote: 'Kunder sendes direkte til deres egen private portal. Bureauet åbner bureaukonsollen.',
    },
    clientAccess: {
      title: 'Kundeportal-adgang & live synkronisering',
      hint: 'Giv kunden deres login — de ser kun deres egen private portal og aldrig bureauet.',
      liveSyncBadge: 'Live RLS-synk',
      portalUrlLabel: 'Kundens login-adresse',
      copyLink: 'Kopiér login-link',
      copied: 'Kopieret',
      copyOnboardingMsg: 'Kopiér velkomstbesked',
      copiedOnboardingMsg: 'Besked kopieret',
      assignedAccounts: 'Tilknyttede kundelogins',
      noAccountsYet: 'Ingen kundebruger oprettet endnu — tilføj én under Team-fanen.',
      isolationTitle: 'Fuld adskillelse',
      isolationBody:
        'Når kunden logger ind, sendes de direkte til /portal. Alle forsøg på at åbne /agency blokeres automatisk og sendes tilbage til /portal.',
      syncTitle: 'Live overblik for bureauet',
      syncBody:
        'Begge sider bruger samme RLS-sikrede PostgreSQL-arbejdsrum. Alt hvad kunden opdaterer (åbningstider, priser, leads, beskeder) ses her med det samme.',
      showcaseCta: 'Åbn stemme-demo',
    },
  },
};

export function getDictionary(locale: AppLocale): UiDictionary {
  return DICTIONARY[locale];
}
