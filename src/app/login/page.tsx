"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  doc,
  getDoc,
} from "firebase/firestore";
import {
  auth,
  db,
} from "@/lib/firebase";
import AppLogo from "@/components/AppLogo";
import AuthBackdrop from "@/components/AuthBackdrop";
import { ThemeToggle } from "@/components/ThemeController";
import { Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("reason");
    if (reason === "deactivated" || reason === "session-expired") {
      const message = reason === "session-expired"
        ? "Your session expired after eight hours. Please sign in again."
        : "This account has been deactivated. Contact an administrator if you believe this is a mistake.";
      const timer = window.setTimeout(() => setError(message), 0);
      return () => window.clearTimeout(timer);
    }
  }, []);


  const login = async () => {
    setError("");
    setNotice("");

    if (!email.trim()) {
      setError("Enter your email address.");
      return;
    }
    if (!password) {
      setError("Enter your password.");
      return;
    }

    try {
      setLoading(true);

      const userCredential =
        await signInWithEmailAndPassword(
          auth,
          email.trim(),
          password
        );

      const user = userCredential.user;

      const userDoc =
        await getDoc(
          doc(db, "users", user.uid)
        );

      const userData = userDoc.data();

      if (userData?.accountStatus === "inactive") {
        await signOut(auth);
        setError("This account has been deactivated. Contact an administrator if you believe this is a mistake.");
        return;
      }

      if (userData?.role === "admin") {
        router.push("/admin");
      } else if (userData?.role === "broker") {
        router.push("/broker");
      } else {
        router.push("/buyer");
      }

    } catch (error: unknown) {
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
      setError(
        code === "auth/invalid-credential" || code === "auth/user-not-found" || code === "auth/wrong-password"
          ? "The email or password is incorrect."
          : code === "auth/too-many-requests"
            ? "Too many attempts. Please wait a moment and try again."
            : code === "auth/network-request-failed"
              ? "We could not connect. Check your internet connection and try again."
              : "We could not sign you in. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async () => {
    setError("");
    setNotice("");
    if (!email.trim()) {
      setError("Enter your email address first, then select “Forgot password?”.");
      return;
    }
    try {
      setResettingPassword(true);
      await sendPasswordResetEmail(auth, email.trim());
      setNotice("Password reset instructions were sent to your email.");
    } catch {
      setError("We could not send the reset email. Check the address and try again.");
    } finally {
      setResettingPassword(false);
    }
  };

  return (
    <div className="auth-layout">
      <AuthBackdrop showTour />
      <main className="auth-main">
        <div className="auth-topline"><Link href="/" className="auth-mobile-brand"><AppLogo className="h-10 w-10 object-contain" alt="" /><span>LiBot</span></Link><ThemeToggle /></div>
        <div className="auth-form-wrap">
          <h1 className="auth-title">Sign in to LiBot</h1>
          <p className="mb-8 mt-3 text-slate-600">Access your account to continue.</p>

          {error && <p id="login-error" role="alert" className="mb-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-700">{error}</p>}
          {notice && <p role="status" className="mb-6 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm leading-relaxed text-emerald-700">{notice}</p>}

          <form className="space-y-6" onSubmit={(event) => { event.preventDefault(); void login(); }} aria-busy={loading}>
            <div>
              <label htmlFor="email" className="mb-2 block text-sm font-medium text-slate-800">Email address</label>
              <input
                id="email"
                type="email"
                name="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                required
                aria-describedby={error ? "login-error" : undefined}
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={loading || resettingPassword}
                className="h-13 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-slate-900 placeholder:text-slate-400 focus:border-slate-600 focus:bg-white focus:outline-none focus:ring-4 focus:ring-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <label htmlFor="password" className="block text-sm font-medium text-slate-800">Password</label>
                <button type="button" onClick={() => void resetPassword()} disabled={loading || resettingPassword} className="text-sm font-medium text-blue-700 hover:underline disabled:opacity-50">
                  {resettingPassword ? "Sending…" : "Forgot password?"}
                </button>
              </div>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  name="password"
                  autoComplete="current-password"
                  required
                  aria-describedby={error ? "login-error" : undefined}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={loading}
                  className="h-13 w-full rounded-xl border border-slate-200 bg-slate-50 pl-4 pr-14 text-slate-900 placeholder:text-slate-400 focus:border-slate-600 focus:bg-white focus:outline-none focus:ring-4 focus:ring-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  disabled={loading}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-slate-400 hover:text-slate-600 disabled:cursor-not-allowed"
                >
                  {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                </button>
              </div>
            </div>
            <button type="submit" disabled={loading || resettingPassword} className="ui-button ui-button-primary h-13 w-full text-base">
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <div className="mt-8 border-t border-slate-100 pt-7 text-center">
            <p className="text-sm text-slate-600">
              New to LiBot? <Link href="/register/choose" className="font-semibold text-slate-900 hover:underline">Create an account</Link>
            </p>
            <Link href="/install" className="mt-5 inline-block text-xs text-slate-500 hover:underline">Install LiBot</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
