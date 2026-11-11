import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadChatContext, loadChatMessages } from '@/lib/db/chat';
import { ChatClient } from './ChatClient';

export const dynamic = 'force-dynamic';

const loadContext = cache(loadChatContext);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ contactId: string }>;
}): Promise<Metadata> {
  const { contactId } = await params;
  const context = await loadContext(contactId).catch(() => null);
  if (!context) return { title: 'Chat unavailable' };
  return {
    title: `Chat med ${context.tenant.name}`,
    description: `Ask ${context.tenant.name} a question or describe your project.`,
    robots: { index: false, follow: false },
  };
}

export default async function PublicChatPage({
  params,
}: {
  params: Promise<{ contactId: string }>;
}) {
  const { contactId } = await params;
  const context = await loadContext(contactId).catch(() => null);
  if (!context || context.tenant.status !== 'active') notFound();

  const messages = await loadChatMessages(context.tenant.id, contactId, 30);
  const publicMessages = messages
    .filter((message) => message.sender === 'customer' || message.sender === 'ai')
    .map((message) => ({
      id: message.id,
      role: message.sender === 'customer' ? ('customer' as const) : ('ai' as const),
      content: message.content,
      channel: message.channel,
      createdAt: message.created_at,
    }));

  return (
    <main className="min-h-screen bg-[var(--bg-ground)] px-5 py-6 text-[var(--text)] sm:px-8">
      <ChatClient
        contactId={contactId}
        contactName={context.contact.full_name}
        tenantName={context.tenant.name}
        isDanish={context.contact.preferred_language.startsWith('da')}
        initialMessages={publicMessages}
        autoReply={context.contact.ai_auto_reply_enabled}
      />
    </main>
  );
}
