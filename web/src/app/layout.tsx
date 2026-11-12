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
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FAF7F2' },
    { media: '(prefers-color-scheme: dark)', color: '#1C1512' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="da" className="light" data-theme="light" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
