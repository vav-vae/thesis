"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

import {
  signInWithEmailAndPassword,
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
  Building2,
} from "lucide-react";

import {
  auth,
  db,
} from "@/lib/firebase";

export default function LoginPage() {

  const router = useRouter();

  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [showPassword, setShowPassword] =
    useState(false);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");

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

      const user =
        userCredential.user;

      const userDoc =
        await getDoc(
          doc(db, "users", user.uid)
        );

      const userData =
        userDoc.data();

      if (userData?.role === "broker") {

        router.push("/broker");

      } else {

        router.push("/buyer");

      }

    } catch (error: unknown) {

      const err = error instanceof Error ? error.message : String(error);

      console.log(err);

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
    <div className="min-h-screen grid lg:grid-cols-2 bg-[#f8f7f4]">
      <div className="hidden lg:flex relative overflow-hidden">
        <Image src="https://images.unsplash.com/photo-1552321554-5fefe8c9ef14?q=80&w=1974&auto=format&fit=crop" alt="Modern Office" fill className="object-cover" />
        <div className="absolute inset-0 bg-black/50" />
        <div className="relative z-10 flex flex-col justify-between p-16 text-white">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-white text-black flex items-center justify-center">
              <Building2 size={28} />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-wide">LiBot</h1>
              <p className="text-white/70 uppercase tracking-[0.25em] text-xs">Immersive Real Estate</p>
            </div>
          </div>
          <div className="max-w-xl">
            <p className="uppercase tracking-[0.3em] text-sm text-white/60 mb-6">Intelligent Virtual Tour Technology</p>
            <h2 className="text-6xl leading-tight font-bold mb-8">Welcome Back to<span className="text-[#d6a77a]"> LiBot</span></h2>
            <p className="text-lg text-white/75 leading-relaxed">Continue managing and showcasing your properties with our AI-powered virtual tour platform.</p>
          </div>
          <div className="flex gap-8 text-sm text-white/60">
            <p>AI Technology</p>
            <p>Virtual Tours</p>
            <p>Property Showcase</p>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-center p-6 lg:p-16">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center justify-center gap-3 mb-10">
            <div className="w-12 h-12 rounded-2xl bg-black text-white flex items-center justify-center">
              <Building2 size={22} />
            </div>
            <div>
              <h1 className="text-2xl font-bold">LiBot</h1>
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Real Estate Platform</p>
            </div>
          </div>
          <div className="glass-card rounded-[32px] p-8 lg:p-10">
            <div className="mb-8">
              <h1 className="text-4xl font-bold text-[#111111] mb-3">Welcome<span className="text-luxury"> Back</span></h1>
              <p className="text-zinc-500 leading-relaxed">Sign in to access your property portfolio and AI tours.</p>
            </div>
            {error && <div className="mb-6 bg-red-50 border border-red-200 text-red-700 text-sm rounded-2xl px-4 py-3">{error}</div>}
            <div className="space-y-5">
              <div>
                <label className="text-sm font-medium text-zinc-700 mb-2 block">Email Address</label>
                <div className="input-premium rounded-2xl h-14 flex items-center px-4 gap-3">
                  <Mail size={18} className="text-zinc-400" />
                  <input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} onKeyPress={handleKeyPress} className="bg-transparent outline-none w-full text-black placeholder:text-zinc-400" />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-zinc-700 mb-2 block">Password</label>
                <div className="input-premium rounded-2xl h-14 flex items-center px-4 gap-3">
                  <Lock size={18} className="text-zinc-400" />
                  <input type={showPassword ? "text" : "password"} placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyPress={handleKeyPress} className="bg-transparent outline-none w-full text-black placeholder:text-zinc-400" />
                  <button onClick={() => setShowPassword(!showPassword)} className="text-zinc-400 hover:text-black">
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              <button onClick={login} disabled={loading} className="btn-luxury w-full h-14 rounded-2xl font-semibold flex items-center justify-center gap-2 mt-4">
                {loading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : "Sign In"}
              </button>
            </div>
            <div className="mt-8 space-y-4 text-center">
              <p className="text-zinc-500">
                <Link href="#" className="text-black hover:text-[#c08457] font-medium transition-colors">
                  Forgot your password?
                </Link>
              </p>
              <p className="text-zinc-500">
                Don&apos;t have an account?
                <Link href="/register" className="text-black font-semibold ml-2 hover:text-[#c08457]">
                  Create one
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}