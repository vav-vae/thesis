import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "./firebase";
import { sanitizeDiagnosticText } from "./capture-diagnostics";

let sessionId = "";
let sent = 0;
let pending = 0;

/** Best effort telemetry: never block capture, upload, or publishing. */
export function recordTourLog(level: "info" | "error", message: string, detail = "", propertyId = "") {
  const user = auth.currentUser;
  if (!user || typeof window === "undefined" || sent >= 300 || pending >= 10) return;
  sessionId ||= crypto.randomUUID();
  sent += 1;
  pending += 1;
  const clean = (value: string, max: number) => sanitizeDiagnosticText(value).slice(0, max);
  void addDoc(collection(db, "tourLogs"), {
    brokerId: user.uid,
    sessionId,
    propertyId: propertyId.slice(0, 128),
    level,
    message: clean(message, 1000),
    detail: clean(detail, 12000),
    page: window.location.pathname.slice(0, 256),
    browser: navigator.userAgent.slice(0, 512),
    online: navigator.onLine,
    clientTime: new Date().toISOString(),
    createdAt: serverTimestamp(),
  }).catch(() => {
    // Reporting failures must not recursively generate telemetry.
  }).finally(() => { pending -= 1; });
}
