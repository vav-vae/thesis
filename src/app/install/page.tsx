export const metadata = { title: "Install LiBot" };

export default function InstallPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-12 text-slate-900">
      <div className="mx-auto max-w-2xl rounded-3xl bg-white p-8 shadow-xl ring-1 ring-slate-200">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-teal-700">LiBot</p>
        <h1 className="mt-2 text-3xl font-bold">Install LiBot</h1>
        <p className="mt-3 text-slate-600">Install LiBot for quick access and a safe offline fallback.</p>
        <div className="mt-8 space-y-6 text-slate-700">
          <p><strong>Android:</strong> Open LiBot in Chrome, tap the menu, then choose “Install app” or “Add to Home screen.”</p>
          <p><strong>Desktop:</strong> In Chrome or Edge, select the install icon in the address bar, then confirm.</p>
          <p><strong>iPhone/iPad:</strong> Open LiBot in Safari, tap Share, choose “Add to Home Screen,” then tap Add.</p>
        </div>
        <a className="mt-8 inline-block font-semibold text-teal-700 underline" href="/login">Return to LiBot</a>
      </div>
    </main>
  );
}
