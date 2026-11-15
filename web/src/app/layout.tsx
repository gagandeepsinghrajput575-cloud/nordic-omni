import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/inter';
import './globals.css';
import { ThemeProvider } from '@/lib/theme/ThemeContext';
import { themeInitScript } from '@/lib/theme/theme-script';

export const metadata: Metadata = {
  title: { default: 'Nordic Omni — Your business, in conversation', template: '%s · Nordic Omni' },
  description: 'A calm workspace for AI reception, customer conversations and business operations. Built for Danish and international businesses.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // One obsidian identity, so the browser chrome matches on every OS setting.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#050507' },
    { media: '(prefers-color-scheme: dark)', color: '#050507' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="da" className="dark" data-theme="dark" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
