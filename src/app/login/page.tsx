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
    <div className="grid min-h-screen bg-slate-50 lg:grid-cols-[1.08fr_0.92fr]">
      <div className="relative hidden overflow-hidden bg-slate-950 bg-[url('/background.png')] bg-cover bg-center p-12 text-white lg:flex lg:flex-col xl:p-16">
        <video
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster="/background.png"
          aria-hidden="true"
          tabIndex={-1}
          className="absolute inset-0 h-full w-full object-cover object-center motion-reduce:hidden"
        >
          <source src="/login-background.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-slate-950/35" />
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950/35 via-slate-950/10 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/45 via-transparent to-slate-950/10" />
        <div className="relative z-10">
          <div className="mb-16 flex items-center gap-3">
            <AppLogo className="h-12 w-12 shrink-0 object-contain" />
            <p className="text-2xl font-medium tracking-tight">LiBot</p>
          </div>
          <h2 className="mb-6 max-w-2xl text-5xl font-medium leading-[1.08] xl:text-6xl">
            Manage every property interaction in one place.
          </h2>
        </div>
      </div>

      <main className="flex items-center justify-center p-5 sm:p-8 lg:bg-white lg:p-12">
        <div className="w-full max-w-md p-6 sm:p-8 lg:p-0">
          <div className="mb-10 inline-flex items-center gap-2 lg:hidden">
            <AppLogo className="h-10 w-10 object-contain" />
            <div>
              <p className="text-sm font-semibold text-slate-900">LiBot</p>
              <p className="text-xs text-slate-500">Real Estate</p>
            </div>
          </div>
          <h1 className="mb-10 text-4xl font-light tracking-tight text-slate-900">Welcome back</h1>

          {error && <p id="login-error" role="alert" className="mb-6 rounded-xl border border-red-100 bg-red-50 p-4 text-sm leading-relaxed text-red-700">{error}</p>}
          {notice && <p role="status" className="mb-6 rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-700">{notice}</p>}

          <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); void login(); }} aria-busy={loading}>
            <div>
              <label htmlFor="email" className="mb-3 block text-xs font-semibold uppercase tracking-wider text-slate-600">Email address</label>
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
                className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-slate-900 placeholder:text-slate-400 focus:border-slate-300 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <label htmlFor="password" className="block text-xs font-semibold uppercase tracking-wider text-slate-600">Password</label>
                <button type="button" onClick={() => void resetPassword()} disabled={loading || resettingPassword} className="text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-50">
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
                  className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 pl-4 pr-14 text-slate-900 placeholder:text-slate-400 focus:border-slate-300 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
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
            <button type="submit" disabled={loading || resettingPassword} className="mt-8 flex h-12 w-full items-center justify-center rounded-xl bg-[#2563eb] font-semibold text-white shadow-sm hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-50">
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <div className="mt-8 space-y-4 text-center">
            <p className="text-sm text-slate-600">
              Don&apos;t have an account? <Link href="/register/choose" className="font-semibold text-slate-900 hover:underline">Create one</Link>
            </p>
            <Link href="/install" className="inline-block text-xs text-slate-500 hover:underline">Install LiBot</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
