import Link from "next/link";
import AppLogo from "@/components/AppLogo";
import AuthBackdrop from "@/components/AuthBackdrop";

const options = [
  { title: "Buyer", description: "Find a property and arrange a viewing.", href: "/register?role=buyer" },
  { title: "Broker", description: "List properties and manage inquiries.", href: "/register?role=broker" },
];

export default function RegisterChoosePage() {
  return (
    <div className="auth-layout">
      <AuthBackdrop />
      <main className="auth-main">
        <div className="auth-mobile-brand"><AppLogo className="h-10 w-10 object-contain" alt="" /><span>LiBot</span></div>
        <div className="auth-form-wrap">
          <h1 className="auth-title">Create an account</h1>
          <p className="mt-3 text-sm text-slate-500">I’m joining as a…</p>
          <div className="mt-8 border-t border-slate-200">
            {options.map((option) => (
              <Link key={option.title} href={option.href} className="auth-role-option">
                <span><span className="block text-lg font-medium text-slate-900">{option.title}</span><span className="mt-1 block text-sm text-slate-500">{option.description}</span></span>
                <span className="auth-role-arrow" aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
          <p className="auth-account-link">Already registered? <Link href="/login">Sign in</Link></p>
        </div>
        <footer className="auth-footer"><span>LiBot</span><Link href="/login">Back to sign in</Link></footer>
      </main>
    </div>
  );
}
