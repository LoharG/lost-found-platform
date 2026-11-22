export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="grid animate-pulse grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-72 rounded-xl bg-surface-muted" />
      ))}
    </div>
  );
}
