import Link from "next/link";
import AppLogo from "@/components/AppLogo";
import AuthBackdrop from "@/components/AuthBackdrop";
import { Building2, House } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeController";

const options = [
  { title: "Buyer", description: "Find a property and arrange a viewing.", href: "/register?role=buyer", icon: House },
  { title: "Broker", description: "List properties and manage inquiries.", href: "/register?role=broker", icon: Building2 },
];

export default function RegisterChoosePage() {
  return (
    <div className="auth-layout">
      <AuthBackdrop />
      <main className="auth-main">
        <div className="auth-topline"><Link href="/" className="auth-mobile-brand"><AppLogo className="h-10 w-10 object-contain" alt="" /><span>LiBot</span></Link><ThemeToggle /></div>
        <div className="auth-form-wrap">
          <h1 className="auth-title">Create an account</h1>
          <p className="mt-3 text-slate-600">Choose how you’ll use LiBot.</p>
          <div className="mt-8 grid gap-3">
            {options.map(({ title, description, href, icon: Icon }) => (
              <Link key={title} href={href} className="auth-role-option">
                <span className="auth-role-icon"><Icon size={22} aria-hidden="true" /></span>
                <span><span className="block text-lg font-semibold text-slate-900">{title}</span><span className="mt-1 block text-sm text-slate-600">{description}</span></span>
              </Link>
            ))}
          </div>
          <p className="auth-account-link">Already registered? <Link href="/login">Sign in</Link></p>
        </div>
      </main>
    </div>
  );
}
