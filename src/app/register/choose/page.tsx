import Link from "next/link";
import { ArrowRight, BadgeCheck, Home, ShieldCheck, Sparkles } from "lucide-react";

const options = [
  {
    title: "Buyer",
    description: "Browse properties, save favorites, and manage your search profile.",
    href: "/register?role=buyer",
    icon: Home,
    accent: "from-slate-900 to-slate-700",
  },
  {
    title: "Broker",
    description: "Manage listings, upload media, and handle property inquiries.",
    href: "/register?role=broker",
    icon: BadgeCheck,
    accent: "from-cyan-600 to-slate-900",
  },
];

export default function RegisterChoosePage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="absolute inset-x-0 top-0 h-80 bg-[radial-gradient(circle_at_top_left,_rgba(15,23,42,0.10),_transparent_40%),radial-gradient(circle_at_top_right,_rgba(14,165,233,0.12),_transparent_38%)] pointer-events-none" />

      <main className="relative mx-auto flex min-h-screen max-w-5xl items-center px-4 py-10 sm:px-6 lg:px-8">
        <div className="w-full">
          <div className="mb-8 flex items-center gap-2 text-slate-500">
            <ShieldCheck size={18} />
            <p className="text-sm font-medium uppercase tracking-[0.25em]">Create account</p>
          </div>

          <div className="mb-10 max-w-2xl">
            <h1 className="text-4xl font-light tracking-tight text-slate-900 sm:text-5xl">
              Choose the account type that fits you.
            </h1>
            <p className="mt-4 text-base leading-7 text-slate-600 sm:text-lg">
              Select buyer if you want to explore properties, or broker if you want to manage listings and clients.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {options.map((option) => {
              const Icon = option.icon;

              return (
                <Link
                  key={option.title}
                  href={option.href}
                  className="group rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl"
                >
                  <div className={`mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${option.accent} text-white shadow-lg`}>
                    <Icon size={24} />
                  </div>

                  <h2 className="text-2xl font-semibold text-slate-900">{option.title}</h2>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{option.description}</p>

                  <div className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
                    Continue as {option.title.toLowerCase()}
                    <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
                  </div>
                </Link>
              );
            })}
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-3 text-sm text-slate-500">
            <Sparkles size={16} />
            <span>You can only create one account type at a time.</span>
          </div>
        </div>
      </main>
    </div>
  );
}