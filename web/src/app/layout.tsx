import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/inter';
import './globals.css';
import { ThemeProvider } from '@/lib/theme/ThemeContext';
import { themeInitScript } from '@/lib/theme/theme-script';
import { LocaleProvider } from '@/lib/i18n/LocaleContext';
import { getServerLocale } from '@/lib/i18n/server';

export const metadata: Metadata = {
  title: { default: 'Nordic Omni — Your business, in conversation', template: '%s · Nordic Omni' },
  description: 'A calm workspace for AI reception, customer conversations and business operations. Built for Danish and international businesses.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The browser chrome follows the theme the visitor actually gets: the saved
  // preference is applied by an inline script, so these two cover the OS case.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafafa' },
    { media: '(prefers-color-scheme: dark)', color: '#050507' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const initialLocale = await getServerLocale('en');
  return (
    <html lang={initialLocale} className="light" data-theme="light" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&display=swap"
        />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <ThemeProvider>
          <LocaleProvider initialLocale={initialLocale}>{children}</LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
