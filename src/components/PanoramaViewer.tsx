"use client";

import { useEffect, useRef } from "react";

export default function PanoramaViewer({ panorama, caption }: { panorama: string; caption?: string }) {
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

  return <figure><div ref={containerRef} aria-label={caption || "Interactive 360-degree panorama"} className="relative h-[28rem] w-full cursor-grab overflow-hidden rounded-2xl bg-slate-950 active:cursor-grabbing" />{caption && <figcaption className="mt-2 text-center text-xs text-slate-500">{caption} · Drag to look around · Scroll to zoom</figcaption>}</figure>;
}
