"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { canAccessRole, roleHome, type AccountRole } from "@/lib/role-access";

export default function RoleGuard({ role, children }: { role: AccountRole; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [access, setAccess] = useState<{ uid: string; allowed: boolean; error?: boolean } | null>(null);
  // Listings remain public; personal buyer pages require the buyer role.
  const publicListing = role === "buyer" && (pathname === "/buyer/properties" || pathname.startsWith("/buyer/properties/"));

  useEffect(() => {
    if (publicListing) return;
    let disposed = false;
    let stopProfile = () => {};
    let generation = 0;
    const stopAuth = onAuthStateChanged(auth, (user) => {
      const current = ++generation;
      stopProfile();
      setAccess(null);
      if (!user) { router.replace("/login"); return; }
      stopProfile = onSnapshot(doc(db, "users", user.uid), { includeMetadataChanges: true }, (snapshot) => {
        if (disposed || current !== generation || snapshot.metadata.fromCache) return;
        const account = snapshot.data() ?? {};
        const allowed = snapshot.exists() && canAccessRole(role, account);
        setAccess({ uid: user.uid, allowed });
        if (!allowed) router.replace(account.accountStatus === "inactive" ? "/login?reason=deactivated" : roleHome(account.role));
      }, () => {
        if (!disposed && current === generation) setAccess({ uid: user.uid, allowed: false, error: true });
      });
    });
    return () => { disposed = true; stopProfile(); stopAuth(); };
  }, [publicListing, role, router]);

  if (publicListing || (access?.allowed && access.uid === auth.currentUser?.uid)) return children;
  return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-slate-700">
    {access?.error ? <div role="alert" className="text-center"><p>Unable to verify your account access.</p><button type="button" onClick={() => window.location.reload()} className="mt-4 rounded-xl bg-teal-800 px-5 py-3 text-white">Try again</button></div> : <p role="status">Checking account access…</p>}
  </main>;
}
