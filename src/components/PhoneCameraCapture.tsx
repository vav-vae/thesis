"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Camera, Check, Compass, LoaderCircle, Maximize2, Minimize2, RotateCcw, X } from "lucide-react";

type PhoneCameraCaptureProps = {
  imageNumber: number;
  previousHeading?: number | null;
  onCapture: (file: File, heading?: number) => void | Promise<void>;
  onClose: () => void;
};

function normalizeHeading(value: number) {
  return ((value % 360) + 360) % 360;
}

function shortestTurn(from: number, to: number) {
  return ((to - from + 540) % 360) - 180;
}

export default function PhoneCameraCapture({ imageNumber, previousHeading, onCapture, onClose }: PhoneCameraCaptureProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [starting, setStarting] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [motionError, setMotionError] = useState("");
  const [heading, setHeading] = useState<number | null>(null);
  const [motionEnabled, setMotionEnabled] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);
  const [cameraFrameLandscape, setCameraFrameLandscape] = useState(false);
  const [landscapeOverride, setLandscapeOverride] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const landscapeReady = isLandscape || cameraFrameLandscape || landscapeOverride;

  const targetHeading = previousHeading == null ? null : normalizeHeading(previousHeading + 45);
  const turn = heading != null && targetHeading != null ? shortestTurn(heading, targetHeading) : null;
  const angleError = turn == null ? null : Math.abs(turn);
  const angleReady = targetHeading == null || (angleError != null && angleError <= 10);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    const orientationQuery = window.matchMedia("(orientation: landscape)");
    const updateOrientation = () => {
      const legacyAngle = (window as Window & { orientation?: number }).orientation;
      const screenAngle = screen.orientation?.angle;
      setIsLandscape(
        orientationQuery.matches
        || window.innerWidth > window.innerHeight
        || Math.abs(legacyAngle ?? 0) === 90
        || screenAngle === 90
        || screenAngle === 270
      );
    };
    const updateFullscreen = () => setIsFullscreen(document.fullscreenElement === dialogRef.current);
    updateOrientation();
    orientationQuery.addEventListener("change", updateOrientation);
    window.addEventListener("resize", updateOrientation);
    window.addEventListener("orientationchange", updateOrientation);
    window.visualViewport?.addEventListener("resize", updateOrientation);
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () => {
      orientationQuery.removeEventListener("change", updateOrientation);
      window.removeEventListener("resize", updateOrientation);
      window.removeEventListener("orientationchange", updateOrientation);
      window.visualViewport?.removeEventListener("resize", updateOrientation);
      document.removeEventListener("fullscreenchange", updateFullscreen);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Live camera access is unavailable in this browser. Use the file picker instead.");
        setStarting(false);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (cameraError) {
        console.error("Unable to start phone camera:", cameraError);
        setError("Camera permission was denied or no rear camera is available. Allow camera access and try again.");
      } finally {
        if (!cancelled) setStarting(false);
      }
    }
    void startCamera();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [stopCamera]);

  useEffect(() => {
    if (!motionEnabled) return;
    const updateHeading = (event: DeviceOrientationEvent) => {
      const compassEvent = event as DeviceOrientationEvent & { webkitCompassHeading?: number };
      const nextHeading = compassEvent.webkitCompassHeading ?? (event.alpha == null ? null : normalizeHeading(360 - event.alpha));
      if (nextHeading != null) setHeading(nextHeading);
    };
    window.addEventListener("deviceorientation", updateHeading, true);
    return () => window.removeEventListener("deviceorientation", updateHeading, true);
  }, [motionEnabled]);

  const enableMotionGuide = async () => {
    try {
      const orientationApi = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
        requestPermission?: () => Promise<"granted" | "denied">;
      };
      if (orientationApi.requestPermission) {
        const permission = await orientationApi.requestPermission();
        if (permission !== "granted") throw new Error("Motion permission was denied.");
      }
      setMotionEnabled(true);
    } catch (motionError) {
      setMotionError(motionError instanceof Error ? motionError.message : "The angle guide is unavailable.");
    }
  };

  const capture = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight || saving) return;
    if (!landscapeReady) {
      setError("Rotate your phone to landscape before capturing.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const canvas = document.createElement("canvas");
      const rotateLandscapeFrame = landscapeReady && video.videoHeight > video.videoWidth;
      canvas.width = rotateLandscapeFrame ? video.videoHeight : video.videoWidth;
      canvas.height = rotateLandscapeFrame ? video.videoWidth : video.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("The camera frame could not be prepared.");
      if (rotateLandscapeFrame) {
        const screenAngle = screen.orientation?.angle ?? 90;
        const clockwise = screenAngle !== 270;
        context.translate(canvas.width / 2, canvas.height / 2);
        context.rotate(clockwise ? Math.PI / 2 : -Math.PI / 2);
        context.drawImage(video, -video.videoWidth / 2, -video.videoHeight / 2);
      } else {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
      }
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      if (!blob) throw new Error("The camera frame could not be saved.");
      const file = new File([blob], `capture-${imageNumber}-${Date.now()}.jpg`, { type: "image/jpeg" });
      stopCamera();
      await onCapture(file, heading ?? undefined);
      onClose();
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : "The image could not be captured.");
      setSaving(false);
    }
  };

  const close = () => {
    stopCamera();
    onClose();
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await dialogRef.current?.requestFullscreen();
      }
    } catch {
      setMotionError("Browser fullscreen is unavailable, but the camera still fills the page.");
    }
  };

  return (
    <div ref={dialogRef} className="fixed inset-0 z-[100] flex h-dvh w-screen items-center justify-center bg-black" role="dialog" aria-modal="true" aria-label={`Capture image ${imageNumber}`}>
      <div className="flex h-full w-full flex-col overflow-hidden bg-slate-950 text-white">
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3 sm:px-5 sm:py-4">
          <div><p className="text-xs font-semibold uppercase tracking-wider text-blue-300">Phone camera</p><h2 className="mt-1 font-semibold">Capture Image {imageNumber}</h2></div>
          <div className="flex gap-2"><button type="button" onClick={() => void toggleFullscreen()} aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"} className="rounded-full bg-white/10 p-2 hover:bg-white/20">{isFullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}</button><button type="button" onClick={close} aria-label="Close camera" className="rounded-full bg-white/10 p-2 hover:bg-white/20"><X size={20} /></button></div>
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
          <video ref={videoRef} playsInline muted onLoadedMetadata={(event) => setCameraFrameLandscape(event.currentTarget.videoWidth > event.currentTarget.videoHeight)} className="h-full w-full object-cover" />
          {starting && <div className="absolute inset-0 flex items-center justify-center"><LoaderCircle className="animate-spin text-blue-300" size={32} /></div>}
          <div className="pointer-events-none absolute inset-y-0 left-1/4 border-l border-dashed border-white/35" />
          <div className="pointer-events-none absolute inset-y-0 right-1/4 border-r border-dashed border-white/35" />
          <div className={`absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-3 rounded-2xl border px-5 py-3 shadow-xl backdrop-blur ${angleReady && heading != null ? "border-emerald-300 bg-emerald-500/85" : "border-red-300 bg-red-500/85"}`}>
            {targetHeading == null ? <Check size={26} /> : turn != null && Math.abs(turn) <= 10 ? <Check size={26} /> : turn != null && turn > 0 ? <ArrowRight size={30} /> : <ArrowLeft size={30} />}
            <div><p className="text-sm font-bold">{targetHeading == null ? "Choose your starting view" : angleReady && heading != null ? "Angle ready" : turn == null ? "Enable angle guide" : `Turn ${Math.round(Math.abs(turn))}°`}</p><p className="text-[11px] text-white/80">{targetHeading == null ? "Keep this position for every shot" : "Target rotation: approximately 45°"}</p></div>
          </div>
        </div>
        <div className="shrink-0 p-3 sm:p-5">
          <p className={`text-center text-sm font-medium ${landscapeReady ? "text-emerald-300" : "text-amber-200"}`}>{landscapeReady ? "Landscape ready — keep the phone steady." : "Rotate your phone to landscape before capturing."}</p>
          {!landscapeReady && <button type="button" onClick={() => setLandscapeOverride(true)} className="mx-auto mt-2 flex rounded-lg border border-amber-300/40 bg-amber-300/10 px-3 py-1.5 text-xs font-semibold text-amber-100">I’m holding it landscape</button>}
          <p className="mt-1 text-center text-xs text-white/60 sm:text-sm">Remain in one position and keep 30–50% of the previous view inside the guide lines.</p>
          {!motionEnabled && <button type="button" onClick={() => void enableMotionGuide()} className="mx-auto mt-3 flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20"><Compass size={17} />Enable angle guide</button>}
          {motionEnabled && heading == null && <p className="mt-3 text-center text-xs text-amber-200">Move the phone gently to initialize its orientation sensor.</p>}
          {motionError && <p className="mt-3 text-center text-xs text-amber-200">{motionError} You may still capture using the overlap guide lines.</p>}
          {error && <p role="alert" className="mt-3 rounded-xl bg-red-500/15 p-3 text-center text-sm text-red-200">{error}</p>}
          <div className="mt-5 flex justify-center gap-3">
            <button type="button" onClick={close} className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-5 py-3 text-sm font-semibold"><RotateCcw size={18} />Cancel</button>
            <button type="button" onClick={() => void capture()} disabled={starting || saving || Boolean(error) || !landscapeReady || (motionEnabled && !angleReady)} className={`inline-flex items-center gap-2 rounded-xl px-7 py-3 text-sm font-semibold disabled:opacity-40 ${landscapeReady && angleReady ? "bg-emerald-600" : "bg-red-600"}`}>{saving ? <LoaderCircle className="animate-spin" size={18} /> : <Camera size={18} />}{saving ? "Saving…" : !landscapeReady ? "Rotate phone" : angleReady ? "Capture" : "Align angle"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
