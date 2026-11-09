"use client";

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-slate-900">
      <section className="w-full max-w-lg rounded-3xl bg-white p-8 text-center shadow-xl ring-1 ring-slate-200">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-700 text-2xl font-bold text-white">L</div>
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.2em] text-teal-700">LiBot</p>
        <h1 className="text-3xl font-bold tracking-tight">You’re offline</h1>
        <p className="mt-4 text-slate-600">LiBot could not reach the network. Reconnect to continue managing listings, schedules, and virtual tours.</p>
        <button className="mt-7 rounded-xl bg-teal-700 px-5 py-3 font-semibold text-white" onClick={() => window.location.reload()}>Try again</button>
      </section>
    </main>
  );
}
