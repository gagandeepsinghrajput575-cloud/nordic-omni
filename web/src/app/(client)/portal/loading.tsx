import { Skeleton } from '@/components/ui/feedback';

export default function PortalLoading() {
  return (
    <div role="status" aria-label="Loading workspace" className="space-y-7">
      <div className="space-y-3"><Skeleton className="h-7 w-56" /><Skeleton className="h-4 w-80 max-w-full" /></div>
      <Skeleton className="h-36 w-full rounded-xl" />
      <div className="stats-grid">{[0, 1, 2, 3].map((key) => <div className="stat" key={key}><Skeleton className="mb-4 h-3 w-20" /><Skeleton className="h-8 w-24" /></div>)}</div>
      <div className="glass space-y-5 p-5">{[0, 1, 2, 3].map((key) => <div key={key} className="flex items-center gap-4"><Skeleton className="h-9 w-9 rounded-full" /><Skeleton className="h-4 flex-1" /><Skeleton className="h-6 w-16" /></div>)}</div>
      <span className="sr-only">Loading live workspace data…</span>
    </div>
  );
}
