import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from '@/lib/theme/ThemeContext';

export const metadata: Metadata = {
  title: 'NORDIC-OMNI | Multi-Tenant Voice & Meta AI Platform',
  description: 'Realtime omnichannel voice and meta messaging platform for Danish and international business operations.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="da" className="dark">
      <body className="bg-[var(--bg-ground,#07090E)] text-[var(--text-primary,#F8FAFC)] min-h-screen antialiased selection:bg-[var(--accent-primary,#00F5D4)] selection:text-black">
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
