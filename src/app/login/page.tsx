"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  doc,
  getDoc,
} from "firebase/firestore";
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  Sparkles,
  ShieldCheck,
  CalendarDays,
} from "lucide-react";
import {
  auth,
  db,
} from "@/lib/firebase";

const HERO_HEADLINES = [
  "Find a place worth stepping into.",
  "Explore every room before you visit.",
  "See properties from a whole new angle.",
  "Turn static images into immersive tours.",
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [typedHeadline, setTypedHeadline] = useState("");

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("reason") === "deactivated") {
      const timer = window.setTimeout(() => setError("This account has been deactivated. Contact an administrator if you believe this is a mistake."), 0);
      return () => window.clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const timer = window.setTimeout(() => setTypedHeadline(HERO_HEADLINES[0]), 0);
      return () => window.clearTimeout(timer);
    }
    let headlineIndex = 0;
    let characterIndex = 0;
    let deleting = false;
    let timer = 0;
    const animate = () => {
      const headline = HERO_HEADLINES[headlineIndex];
      characterIndex += deleting ? -1 : 1;
      setTypedHeadline(headline.slice(0, characterIndex));
      let delay = deleting ? 38 : 72;
      if (!deleting && characterIndex === headline.length) {
        deleting = true;
        delay = 1800;
      } else if (deleting && characterIndex === 0) {
        deleting = false;
        headlineIndex = (headlineIndex + 1) % HERO_HEADLINES.length;
        delay = 350;
      }
      timer = window.setTimeout(animate, delay);
    };
    timer = window.setTimeout(animate, 350);
    return () => window.clearTimeout(timer);
  }, []);

  const login = async () => {
    setError("");

    if (!email || !password) {
      setError("Please fill all fields");
      return;
    }

    try {
      setLoading(true);

      const userCredential =
        await signInWithEmailAndPassword(
          auth,
          email,
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
      const err = error instanceof Error ? error.message : String(error);
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !loading) {
      login();
    }
  };

  return (
    <div className="grid min-h-screen bg-slate-50 lg:grid-cols-[1.08fr_0.92fr]">
      
      {/* Left Panel - Hero Section */}
      <div className="relative hidden overflow-hidden bg-slate-950 p-12 text-white lg:flex lg:flex-col lg:justify-between xl:p-16">
        <video
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster="/background.png"
          aria-hidden="true"
          tabIndex={-1}
          className="absolute inset-0 h-full w-full object-cover object-center"
        >
          <source src="/login-background.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-slate-950/35" />
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950/35 via-slate-950/10 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/45 via-transparent to-slate-950/10" />

        <div className="relative z-10">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-16">
            <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center flex-shrink-0">
              <Image
                src="/logo.png"
                alt="LiBot Logo"
                width={40}
                height={40}
                className="object-contain"
                priority
              />
            </div>
            <div>
              <h1 className="text-2xl font-light tracking-tight">Real Estate</h1>
              <p className="text-sm text-slate-400 font-light">by LiBot</p>
            </div>
          </div>

          {/* Hero Content */}
          <div>
            <p className="mb-6 text-xs font-semibold uppercase tracking-[0.22em] text-blue-300">
              Smarter property exploration
            </p>
            <h2 aria-label="Discover properties through LiBot" className="mb-7 min-h-[8rem] max-w-2xl text-5xl font-light leading-[1.08] xl:min-h-[9rem] xl:text-6xl">
              <span aria-hidden="true">{typedHeadline}<span className="ml-1 inline-block h-[0.9em] w-0.5 translate-y-[0.08em] animate-pulse bg-blue-300" /></span>
            </h2>
            <p className="max-w-xl text-lg font-light leading-relaxed text-slate-300">
              LiBot brings listings, reconstructed room panoramas, negotiations, and property viewing schedules into one clear workspace.
            </p>
          </div>
        </div>

        <div className="relative z-10 grid grid-cols-3 gap-4 border-t border-white/10 pt-8">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><Sparkles size={19} className="text-blue-300" /><p className="mt-3 text-sm font-semibold">Immersive tours</p><p className="mt-1 text-xs leading-5 text-slate-400">Static images reconstructed into room panoramas.</p></div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><ShieldCheck size={19} className="text-emerald-300" /><p className="mt-3 text-sm font-semibold">Role-based access</p><p className="mt-1 text-xs leading-5 text-slate-400">Dedicated buyer, broker, and admin workspaces.</p></div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><CalendarDays size={19} className="text-amber-300" /><p className="mt-3 text-sm font-semibold">Viewing schedules</p><p className="mt-1 text-xs leading-5 text-slate-400">Request and manage property appointments.</p></div>
        </div>
      </div>

      {/* Right Panel - Login Form */}
      <div className="flex items-center justify-center p-5 sm:p-8 lg:bg-white lg:p-12">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 lg:border-0 lg:p-0 lg:shadow-none">
          
          {/* Mobile Logo */}
          <div className="lg:hidden mb-10 inline-flex items-center gap-2">
            <div className="w-10 h-10 bg-slate-900 rounded-2xl flex items-center justify-center">
              <Image
                src="/logo.png"
                alt="LiBot Logo"
                width={32}
                height={32}
                className="object-contain"
                priority
              />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">LiBot</p>
              <p className="text-xs text-slate-500">Real Estate</p>
            </div>
          </div>

          {/* Header */}
          <div className="mb-10">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">Secure account access</p>
            <h1 className="mb-3 text-4xl font-light tracking-tight text-slate-900">
              Welcome back
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              Sign in to continue to your LiBot workspace.
            </p>
          </div>

          {/* Error State */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3 animate-slide-down">
              <div className="w-5 h-5 rounded-full bg-red-200 flex-shrink-0 flex items-center justify-center mt-0.5">
                <span className="text-xs text-red-600 font-semibold">!</span>
              </div>
              <p className="text-sm text-red-600 leading-relaxed">{error}</p>
            </div>
          )}

          {/* Form */}
          <div className="space-y-5 mb-8">
            
            {/* Email Input */}
            <div className="group">
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-3">
                Email Address
              </label>
              <div className="relative">
                <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-600 transition-colors" />
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyPress={handleKeyPress}
                  disabled={loading}
                  className="w-full h-12 pl-11 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-300 focus:ring-1 focus:ring-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>
            </div>

            {/* Password Input */}
            <div className="group">
              <div className="mb-3 flex items-center justify-between">
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  Password
                </label>
                <span className="text-xs text-slate-400">Use your registered password</span>
              </div>
              <div className="relative">
                <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-600 transition-colors" />
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyPress={handleKeyPress}
                  disabled={loading}
                  className="w-full h-12 pl-11 pr-12 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-300 focus:ring-1 focus:ring-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={loading}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors disabled:cursor-not-allowed"
                >
                  {showPassword ? (
                    <EyeOff size={16} />
                  ) : (
                    <Eye size={16} />
                  )}
                </button>
              </div>
            </div>

          </div>

          {/* Sign In Button */}
          <button
            onClick={login}
            disabled={loading}
            className="w-full h-12 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-700 text-white font-medium rounded-xl transition-all duration-200 flex items-center justify-center gap-2 group disabled:cursor-not-allowed shadow-sm hover:shadow-md active:scale-95"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                Sign In
                <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
              </>
            )}
          </button>

          {/* Footer Links */}
          <div className="mt-8 space-y-3 text-center">
            <p className="text-sm text-slate-600">
              {`Don't have an account?`}{" "}
              <Link
                href="/register/choose"
                className="font-semibold text-slate-900 hover:text-slate-700 hover:underline transition-colors"
              >
                Create one
              </Link>
            </p>
          </div>

        </div>
      </div>

    </div>
  );
}
