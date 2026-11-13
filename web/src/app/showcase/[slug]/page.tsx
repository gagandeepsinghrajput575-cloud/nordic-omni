import Link from "next/link";
import { notFound } from "next/navigation";
import { ShowcaseExperience } from "@/components/showcase/ShowcaseExperience";
import { Icon, Logo, Pill } from "@/components/ui/primitives";
import { getHours, getKnowledge, getOpenState, getShowcaseBySlug } from "@/lib/data";
import type { Language } from "@/lib/types";

export const dynamic = "force-dynamic";

interface ShowcasePageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: ShowcasePageProps) {
  const { slug } = await params;
  const record = await getShowcaseBySlug(slug);
  if (!record) {
    return { title: "Showcase" };
  }
  return {
    title: record.showcase.title,
    description: record.showcase.subtitle,
  };
}

export default async function ShowcasePage({ params }: ShowcasePageProps) {
  const { slug } = await params;
  const record = await getShowcaseBySlug(slug);
  if (!record) {
    notFound();
  }
  const { showcase, workspace } = record;

  const [hours, knowledge] = await Promise.all([getHours(workspace.id), getKnowledge(workspace.id)]);
  const openState = getOpenState(hours, workspace.timezone);
  const activeKnowledge = knowledge.filter((item) => item.enabled).length;
  const initialLanguage: Language = showcase.language === "en" ? "en" : "da";
  const allowDanish = showcase.language !== "en";
  const allowEnglish = showcase.language !== "da";

  if (!showcase.enabled) {
    return (
      <div className="app-bg flex min-h-dvh items-center justify-center px-5">
        <div className="card max-w-md p-8 text-center">
          <Logo />
          <h1 className="display mt-4 text-[24px] text-[var(--text-primary)]">This pitch room is paused</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-secondary)]">
            {showcase.partnerName} has temporarily unpublished this live demo. The receptionist and all leads remain safe
            inside the workspace.
          </p>
          <Link href="/" className="btn btn-ghost mt-5">
            Back to Nordic-Omni
            <Icon name="arrow" className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    );
  }

  const proof = [
    {
      label: "Zero telephony",
      title: "No phone number required",
      body: "The prospect speaks through the browser microphone. The same grounded receptionist answers production calls.",
    },
    {
      label: "Natural interruption",
      title: "≈150ms barge-in",
      body: "Partial transcripts stop the agent mid-sentence, so the conversation feels like a real reception desk.",
    },
    {
      label: "Revenue ready",
      title: "Lead-to-call in one step",
      body: "Name and number are captured into PostgreSQL and scored, with a callback queued for the on-call team.",
    },
  ];

  return (
    <div className="app-bg">
      <header className="mx-auto flex w-full max-w-[1180px] flex-wrap items-center justify-between gap-3 px-5 py-5">
        <div className="flex items-center gap-3">
          <Logo />
          <span className="hidden h-4 w-px bg-[var(--border-subtle)] sm:block" />
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)] sm:block">
            {showcase.partnerName}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Pill tone={openState.isOpen ? "live" : "warn"}>
            <span className={openState.isOpen ? "dot-live" : "dot-thinking"} />
            {openState.headline}
          </Pill>
          <Link href="/agency" className="btn btn-ghost btn-sm">
            Agency console
            <Icon name="external" className="h-3 w-3" />
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1180px] px-5 pb-14">
        <section className="pt-4 pb-7">
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill tone="accent">
              <span className="dot-live" /> live showcase
            </Pill>
            <Pill>≈150ms barge-in</Pill>
            <Pill>zero telephony</Pill>
            <Pill>{activeKnowledge} grounded sources</Pill>
            <Pill>{workspace.agentName} · {workspace.voiceModel}</Pill>
          </div>
          <h1 className="display mt-4 max-w-3xl text-[32px] text-[var(--text-primary)] sm:text-[44px]">
            {showcase.title}
          </h1>
          <p className="mt-3 max-w-2xl text-[13.5px] leading-relaxed text-[var(--text-secondary)]">
            {showcase.subtitle}
          </p>
        </section>

        <ShowcaseExperience
          slug={showcase.slug}
          workspaceSlug={workspace.slug}
          workspaceName={workspace.name}
          agentName={workspace.agentName}
          greetingDa={workspace.greetingDa}
          greetingEn={workspace.greetingEn}
          initialLanguage={initialLanguage}
          allowDanish={allowDanish}
          allowEnglish={allowEnglish}
          openState={openState}
          escalationPhone={workspace.escalationPhone}
          knowledgeCount={activeKnowledge}
        />

        <section className="mt-10 grid gap-4 sm:grid-cols-3">
          {proof.map((item) => (
            <article key={item.label} className="card p-4">
              <p className="label">{item.label}</p>
              <h2 className="mt-2 text-[13.5px] font-medium text-[var(--text-primary)]">{item.title}</h2>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--text-muted)]">{item.body}</p>
            </article>
          ))}
        </section>

        <section className="card mt-6 flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <p className="label">Operated by {showcase.partnerName}</p>
            <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-[var(--text-secondary)]">
              This receptionist is grounded in {workspace.name}&apos;s own knowledge base, reads the live operating
              schedule, and escalates to {workspace.escalationPhone} when a human is needed.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/agency" className="btn btn-primary btn-sm">
              Build your own showcase
              <Icon name="spark" className="h-3.5 w-3.5" />
            </Link>
            <Link href={`/showcase/${showcase.slug}`} className="btn btn-ghost btn-sm">
              Reload room
              <Icon name="refresh" className="h-3.5 w-3.5" />
            </Link>
          </div>
        </section>

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-5 text-[11px] text-[var(--text-muted)]">
          <span>
            {showcase.accessCount.toLocaleString("da-DK")} views · {showcase.callCount.toLocaleString("da-DK")} live
            conversations · demo room /{showcase.slug}
          </span>
          <span className="font-mono uppercase tracking-[0.12em]">nordic-omni · copenhagen</span>
        </footer>
      </main>
    </div>
  );
}