import AppLogo from "@/components/AppLogo";
import Link from "next/link";
import LoginTourVideo from "@/components/LoginTourVideo";

export default function AuthBackdrop({ showTour = false }: { showTour?: boolean }) {
  return (
    <aside className="auth-backdrop" aria-label="About LiBot">
      {showTour && <LoginTourVideo />}
      <Link href="/" className="auth-brand">
        <AppLogo className="h-11 w-11 object-contain" alt="" />
        <span>LiBot</span>
      </Link>
      <div className="auth-backdrop-copy">
        <p>Explore properties in 360°</p>
        <p>Look around before you book a viewing.</p>
      </div>
    </aside>
  );
}
