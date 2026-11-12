import { Skeleton } from '@/components/ui/feedback';

export default function Loading() {
  return (
    <main className="mx-auto min-h-dvh max-w-lg px-6 py-24" role="status" aria-label="Loading Nordic Omni">
      <Skeleton className="mb-8 h-9 w-40" />
      <Skeleton className="mb-3 h-7 w-52" />
      <Skeleton className="mb-8 h-4 w-72 max-w-full" />
      <div className="space-y-5"><Skeleton className="h-11 w-full" /><Skeleton className="h-11 w-full" /><Skeleton className="h-11 w-full" /></div>
      <span className="sr-only">Loading…</span>
    </main>
  );
}
