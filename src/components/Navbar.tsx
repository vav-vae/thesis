import Link from "next/link";
import AppLogo from "@/components/AppLogo";

export default function Navbar() {
  return (
    <nav className="sticky top-0 z-50 border-b border-slate-800 bg-slate-900 text-slate-50">
      <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <AppLogo className="h-10 w-10" />
          <span className="text-xl font-bold">LiBot</span>
        </Link>
        
        <div className="flex gap-4">
          <Link href="/login" className="transition hover:text-amber-300">
            Login
          </Link>
          <Link href="/register" className="transition hover:text-amber-300">
            Register
          </Link>
        </div>
      </div>
    </nav>
  );
}
