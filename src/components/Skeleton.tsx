export default function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`block animate-pulse rounded-lg bg-slate-200 ${className}`} />;
}

export function DashboardStatSkeleton() {
  return (
    <div className="p-6">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="mt-4 h-9 w-16" />
      <Skeleton className="mt-4 h-3 w-36" />
    </div>
  );
}
