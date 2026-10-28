"use client";

import { useEffect } from "react";
import { onIdTokenChanged, signOut, User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

// Firebase refreshes ID tokens automatically, so a token's `exp` cannot be
// used as a session deadline. `authTime` remains tied to the original sign-in.
const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;

export default function AccountStatusGuard() {
  useEffect(() => {
    let stopUserDocument = () => {};
    let expiryTimer: number | undefined;
    let endingExpiredSession = false;
    let disposed = false;

    const clearExpiryTimer = () => {
      if (expiryTimer !== undefined) {
        window.clearTimeout(expiryTimer);
        expiryTimer = undefined;
      }
    };

    const endExpiredSession = async () => {
      if (disposed || endingExpiredSession) return;
      endingExpiredSession = true;
      clearExpiryTimer();
      stopUserDocument();
      stopUserDocument = () => {};
      try {
        await signOut(auth);
      } finally {
        window.location.replace("/login?reason=session-expired");
      }
    };

    const scheduleSessionExpiry = async (user: User) => {
      try {
        const tokenResult = await user.getIdTokenResult();
        const authenticatedAt = Date.parse(tokenResult.authTime);
        const remaining = authenticatedAt + SESSION_MAX_AGE_MS - Date.now();

        if (disposed) return;
        if (!Number.isFinite(authenticatedAt) || remaining <= 0) {
          await endExpiredSession();
          return;
        }

        expiryTimer = window.setTimeout(() => {
          void endExpiredSession();
        }, remaining);
      } catch (error) {
        console.error("Unable to verify the session lifetime:", error);
        await endExpiredSession();
      }
    };

    const stopAuthentication = onIdTokenChanged(auth, (user) => {
      clearExpiryTimer();
      stopUserDocument();
      stopUserDocument = () => {};
      if (!user) return;

      void scheduleSessionExpiry(user);

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
      disposed = true;
      clearExpiryTimer();
      stopUserDocument();
      stopAuthentication();
    };
  }, []);

  return null;
}
