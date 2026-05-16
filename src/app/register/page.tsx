"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  createUserWithEmailAndPassword,
} from "firebase/auth";

import {
  doc,
  setDoc,
} from "firebase/firestore";

import {
  auth,
  db,
} from "@/lib/firebase";

import {
  Mail,
  Lock,
  User,
  Eye,
  EyeOff,
  Building2,
  ArrowRight,
} from "lucide-react";

export default function RegisterPage() {

  const router = useRouter();

  const [name, setName] =
    useState("");

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

  const register = async () => {

    setError("");

    if (!name || !email || !password) {
      setError("Please fill all fields");
      return;
    }

    try {

      setLoading(true);

      const userCredential =
        await createUserWithEmailAndPassword(
          auth,
          email,
          password
        );

      const user =
        userCredential.user;

      await setDoc(
        doc(db, "users", user.uid),
        {
          uid: user.uid,
          name,
          email,
          role: "buyer",
          createdAt: new Date(),
        }
      );

      router.push("/login");

    } catch (error: unknown) {

      const err = error instanceof Error ? error.message : String(error);

      setError(err);

    } finally {

      setLoading(false);

    }
  };

  return (
    <div className="min-h-screen bg-[#f8f7f4] flex items-center justify-center p-6">

      <div className="w-full max-w-md">

        {/* LOGO */}
        <div className="text-center mb-10">

          <div className="flex justify-center mb-4">

            <div className="w-16 h-16 rounded-2xl bg-black text-white flex items-center justify-center shadow-lg">

              <Building2 size={28} />

            </div>

          </div>

          <h1 className="text-4xl font-bold text-black">
            LiBot
          </h1>

          <p className="uppercase tracking-[0.35em] text-xs text-zinc-500 mt-2">
            Real Estate Platform
          </p>

        </div>

        {/* CARD */}
        <div className="bg-white rounded-[32px] p-8 shadow-[0_10px_40px_rgba(0,0,0,0.08)] border border-zinc-100">

          {/* HEADER */}
          <div className="text-center mb-8">

            <h2 className="text-3xl font-bold text-black mb-3">
              Create Account
            </h2>

            <p className="text-zinc-500 leading-relaxed">
              Experience immersive AI-powered
              property exploration.
            </p>

          </div>

          {/* ERROR */}
          {error && (

            <div className="mb-6 bg-red-50 border border-red-200 text-red-700 text-sm rounded-2xl px-4 py-3">

              {error}

            </div>

          )}

          {/* FORM */}
          <div className="space-y-5">

            {/* NAME */}
            <div>

              <label className="text-sm font-medium text-zinc-700 mb-2 block">
                Full Name
              </label>

              <div className="h-14 rounded-2xl border border-zinc-200 bg-zinc-50 flex items-center px-4 gap-3 focus-within:border-[#c08457] focus-within:bg-white transition-all">

                <User
                  size={18}
                  className="text-zinc-400"
                />

                <input
                  type="text"
                  placeholder="John Doe"
                  value={name}
                  onChange={(e) =>
                    setName(e.target.value)
                  }
                  className="bg-transparent outline-none w-full text-black placeholder:text-zinc-400"
                />

              </div>

            </div>

            {/* EMAIL */}
            <div>

              <label className="text-sm font-medium text-zinc-700 mb-2 block">
                Email Address
              </label>

              <div className="h-14 rounded-2xl border border-zinc-200 bg-zinc-50 flex items-center px-4 gap-3 focus-within:border-[#c08457] focus-within:bg-white transition-all">

                <Mail
                  size={18}
                  className="text-zinc-400"
                />

                <input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) =>
                    setEmail(e.target.value)
                  }
                  className="bg-transparent outline-none w-full text-black placeholder:text-zinc-400"
                />

              </div>

            </div>

            {/* PASSWORD */}
            <div>

              <label className="text-sm font-medium text-zinc-700 mb-2 block">
                Password
              </label>

              <div className="h-14 rounded-2xl border border-zinc-200 bg-zinc-50 flex items-center px-4 gap-3 focus-within:border-[#c08457] focus-within:bg-white transition-all">

                <Lock
                  size={18}
                  className="text-zinc-400"
                />

                <input
                  type={
                    showPassword
                      ? "text"
                      : "password"
                  }
                  placeholder="Create secure password"
                  value={password}
                  onChange={(e) =>
                    setPassword(e.target.value)
                  }
                  className="bg-transparent outline-none w-full text-black placeholder:text-zinc-400"
                />

                <button
                  onClick={() =>
                    setShowPassword(!showPassword)
                  }
                  className="text-zinc-400 hover:text-black"
                >

                  {showPassword
                    ? <EyeOff size={18} />
                    : <Eye size={18} />
                  }

                </button>

              </div>

            </div>

            {/* BUTTON */}
            <button
              onClick={register}
              disabled={loading}
              className="w-full h-14 rounded-2xl bg-black text-white font-semibold flex items-center justify-center gap-2 hover:bg-zinc-800 transition-all mt-2"
            >

              {loading ? (

                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />

              ) : (

                <>

                  Create Account

                  <ArrowRight size={18} />

                </>

              )}

            </button>

          </div>

          {/* FOOTER */}
          <div className="mt-8 text-center">

            <p className="text-zinc-500">

              Already have an account?

              <Link
                href="/login"
                className="text-black font-semibold ml-2 hover:text-[#c08457]"
              >
                Sign In
              </Link>

            </p>

          </div>

        </div>

      </div>

    </div>
  );
}