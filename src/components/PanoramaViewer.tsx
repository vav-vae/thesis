"use client";

import { useEffect, useRef } from "react";

export default function PanoramaViewer({ panorama, caption, fullScreen = false }: { panorama: string; caption?: string; fullScreen?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let viewer: import("marzipano").Viewer | undefined;
    let cancelled = false;
    const container = containerRef.current;
    void import("marzipano").then((Marzipano) => {
      if (cancelled) return;
      viewer = new Marzipano.Viewer(container);
      const source = Marzipano.ImageUrlSource.fromString(panorama);
      const geometry = new Marzipano.EquirectGeometry([{ width: 4096 }]);
      const limiter = Marzipano.RectilinearView.limit.traditional(4096, (100 * Math.PI) / 180);
      const view = new Marzipano.RectilinearView({ yaw: 0, pitch: 0, fov: (85 * Math.PI) / 180 }, limiter);
      viewer.createScene({ source, geometry, view, pinFirstLevel: true }).switchTo();
    });
    return () => {
      cancelled = true;
      viewer?.destroy();
    };
  }, [panorama]);

  return <figure className={fullScreen ? "h-full" : undefined}><div ref={containerRef} aria-label={caption || "Interactive panorama"} className={`relative w-full cursor-grab overflow-hidden bg-slate-950 active:cursor-grabbing ${fullScreen ? "h-full rounded-xl" : "h-[28rem] rounded-2xl"}`} />{caption && !fullScreen && <figcaption className="mt-2 text-center text-xs text-slate-500">{caption} · Drag to look around</figcaption>}</figure>;
}
