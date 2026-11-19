"use client";

import { useEffect, useState } from "react";

export default function LoginTourVideo() {
  const [enabled, setEnabled] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px) and (prefers-reduced-motion: no-preference)");
    const sync = () => setEnabled(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  if (!enabled || failed) return null;

  return (
    <video
      className="auth-tour-video"
      src="/login-background.mp4"
      autoPlay
      muted
      loop
      playsInline
      aria-hidden="true"
      onError={() => setFailed(true)}
    />
  );
}
