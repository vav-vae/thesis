"use client";

import { useEffect } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

export default function AccountStatusGuard() {
  useEffect(() => {
    let stopUserDocument = () => {};

    const stopAuthentication = onAuthStateChanged(auth, (user) => {
      stopUserDocument();
      stopUserDocument = () => {};
      if (!user) return;

      stopUserDocument = onSnapshot(doc(db, "users", user.uid), async (snapshot) => {
        if (snapshot.data()?.accountStatus !== "inactive") return;
        try {
          await signOut(auth);
        } finally {
          window.location.replace("/login?reason=deactivated");
        }
      }, (error) => {
        console.error("Unable to monitor account status:", error);
      });
    });

    return () => {
      stopUserDocument();
      stopAuthentication();
    };
  }, []);

  return null;
}
