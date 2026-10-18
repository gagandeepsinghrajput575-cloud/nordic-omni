import type { Metadata } from 'next';
import './globals.css';

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
      <body className="bg-[#06080D] text-white min-h-screen antialiased selection:bg-[#00F5D4] selection:text-black">
        {children}
      </body>
    </html>
  );
}
