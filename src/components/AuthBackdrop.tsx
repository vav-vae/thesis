import AppLogo from "@/components/AppLogo";

export default function AuthBackdrop() {
  return (
    <aside className="auth-backdrop" aria-label="LiBot">
      <video autoPlay muted loop playsInline preload="metadata" poster="/background.png" aria-hidden="true" tabIndex={-1}>
        <source src="/login-background.mp4" type="video/mp4" />
      </video>
      <div className="auth-backdrop-shade" />
      <div className="auth-brand">
        <AppLogo className="h-11 w-11 object-contain" alt="" />
        <span>LiBot</span>
      </div>
    </aside>
  );
}
