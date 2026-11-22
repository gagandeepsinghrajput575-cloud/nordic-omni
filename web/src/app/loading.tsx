import { Skeleton } from '@/components/ui/feedback';

/**
 * Route loading fallback.
 *
 * Deliberately a `<div>`, not a `<main>`: a route may render its own main
 * landmark, and nesting one inside this would leave the document with two.
 * `role="status"` is what announces the fallback, so no landmark is lost.
 */
export default function Loading() {
  return (
    <div className="mx-auto min-h-dvh max-w-lg px-6 py-24" role="status" aria-label="Loading Nordic Omni">
      <Skeleton className="mb-8 h-9 w-40" />
      <Skeleton className="mb-3 h-7 w-52" />
      <Skeleton className="mb-8 h-4 w-72 max-w-full" />
      <div className="space-y-5"><Skeleton className="h-11 w-full" /><Skeleton className="h-11 w-full" /><Skeleton className="h-11 w-full" /></div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
