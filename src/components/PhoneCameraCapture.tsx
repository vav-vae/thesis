"use client";

/* eslint-disable @next/next/no-img-element -- The review image is a temporary local blob URL. */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Camera, CameraIcon, Check, Compass, LoaderCircle, Maximize2, Minimize2, MoreHorizontal, RefreshCcw, RotateCcw, SwitchCamera, Upload, X } from "lucide-react";
import { CAPTURE_GUIDE, rearCameraPitch, type CaptureView } from "@/lib/capture-guide";
import styles from "./PhoneCameraCapture.module.css";

type PhoneCameraCaptureProps = {
  imageNumber: number;
  captureView?: CaptureView;
  previousHeading?: number | null;
  onCapture: (file: File, heading?: number) => void | boolean | Promise<void | boolean>;
  onClose: () => void;
};

function normalizeHeading(value: number) {
  return ((value % 360) + 360) % 360;
}

function shortestTurn(from: number, to: number) {
  return ((to - from + 540) % 360) - 180;
}

function cameraMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (!window.isSecureContext) return "Live camera requires HTTPS. Open the deployed HTTPS site on your phone, or use “Use phone camera” below.";
  if (name === "NotAllowedError" || name === "SecurityError") return "Camera access is blocked. Allow camera permission in your browser or site settings, then retry.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "No camera was found on this device.";
  if (name === "NotReadableError" || name === "TrackStartError") return "The camera is already in use by another app. Close it there, then retry.";
  if (name === "OverconstrainedError") return "This camera does not support the requested mode. Retry with another camera.";
  return "The live camera could not start. Retry or use your phone’s native camera.";
}

export default function PhoneCameraCapture({ imageNumber, captureView = "around", previousHeading, onCapture, onClose }: PhoneCameraCaptureProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraRequestRef = useRef(0);
  const previewUrlRef = useRef("");
  const [starting, setStarting] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [captureError, setCaptureError] = useState("");
  const [motionError, setMotionError] = useState("");
  const [heading, setHeading] = useState<number | null>(null);
  const [pitch, setPitch] = useState<number | null>(null);
  const [motionEnabled, setMotionEnabled] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceIndex, setDeviceIndex] = useState(0);
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [activeStream, setActiveStream] = useState<MediaStream | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsButtonRef = useRef<HTMLButtonElement>(null);

  const targetHeading = captureView !== "around" || previousHeading == null ? null : normalizeHeading(previousHeading + 45);
  const turn = heading != null && targetHeading != null ? shortestTurn(heading, targetHeading) : null;
  const angleReady = targetHeading == null || (turn != null && Math.abs(turn) <= 12);

  useEffect(() => {
    if (!optionsOpen) return;
    const dismissOptions = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOptionsOpen(false);
        optionsButtonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", dismissOptions);
    return () => window.removeEventListener("keydown", dismissOptions);
  }, [optionsOpen]);

  const stopCamera = useCallback(() => {
    cameraRequestRef.current += 1;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setActiveStream(null);
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  }, []);

  const clearPreview = useCallback(() => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = "";
    setPreview(null);
  }, []);

  const startCamera = useCallback(async (requestedDeviceId?: string) => {
    stopCamera();
    const request = cameraRequestRef.current;
    setStarting(true);
    setCameraError("");
    setCaptureError("");
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCameraError(!window.isSecureContext
        ? "Live camera requires HTTPS. Open the deployed HTTPS site on your phone, or use “Use phone camera” below."
        : "Live camera is unavailable in this browser. Use your phone’s native camera below.");
      setStarting(false);
      return;
    }
    try {
      const videoConstraints: MediaTrackConstraints = requestedDeviceId
        ? { deviceId: { exact: requestedDeviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        : { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints });
      if (request !== cameraRequestRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      setActiveStream(stream);
      let available: MediaDeviceInfo[] = [];
      if (navigator.mediaDevices.enumerateDevices) {
        try {
          available = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "videoinput");
        } catch (error) {
          // Some mobile browsers permit capture but do not expose the device list.
          console.warn("Camera list is unavailable:", error);
        }
      }
      if (request !== cameraRequestRef.current) return;
      setDevices(available);
      const activeId = stream.getVideoTracks()[0]?.getSettings().deviceId;
      const activeIndex = available.findIndex((device) => device.deviceId === activeId);
      if (activeIndex >= 0) setDeviceIndex(activeIndex);
    } catch (error) {
      if (request !== cameraRequestRef.current) return;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      console.error("Unable to start phone camera:", error);
      setCameraError(cameraMessage(error));
      setStarting(false);
    }
  }, [stopCamera]);

  useEffect(() => {
    if (preview || !activeStream || !videoRef.current) return;
    const video = videoRef.current;
    const request = cameraRequestRef.current;
    let cancelled = false;
    video.srcObject = activeStream;
    void video.play().then(() => {
      if (cancelled || request !== cameraRequestRef.current) return;
      setCameraReady(true);
      setStarting(false);
    }).catch((error) => {
      if (cancelled || request !== cameraRequestRef.current) return;
      console.error("Unable to play phone camera preview:", error);
      setCameraError(cameraMessage(error));
      stopCamera();
      setStarting(false);
    });
    return () => {
      cancelled = true;
      if (video.srcObject === activeStream) video.srcObject = null;
    };
  }, [activeStream, preview, stopCamera]);

  useEffect(() => {
    const timer = window.setTimeout(() => void startCamera(), 0);
    return () => {
      window.clearTimeout(timer);
      stopCamera();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, [startCamera, stopCamera]);

  useEffect(() => {
    const updateOrientation = () => setIsLandscape(window.innerWidth > window.innerHeight || window.matchMedia("(orientation: landscape)").matches);
    const updateFullscreen = () => setIsFullscreen(document.fullscreenElement === dialogRef.current);
    updateOrientation();
    window.addEventListener("resize", updateOrientation);
    window.addEventListener("orientationchange", updateOrientation);
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () => {
      window.removeEventListener("resize", updateOrientation);
      window.removeEventListener("orientationchange", updateOrientation);
      document.removeEventListener("fullscreenchange", updateFullscreen);
    };
  }, []);

  useEffect(() => {
    if (!motionEnabled) return;
    const updateHeading = (event: DeviceOrientationEvent) => {
      const compassEvent = event as DeviceOrientationEvent & { webkitCompassHeading?: number };
      const nextHeading = compassEvent.webkitCompassHeading ?? (event.alpha == null ? null : normalizeHeading(360 - event.alpha));
      if (nextHeading != null) setHeading(nextHeading);
      const nextPitch = rearCameraPitch(event.beta, event.gamma);
      setPitch(nextPitch == null ? null : Math.round(nextPitch));
    };
    window.addEventListener("deviceorientation", updateHeading, true);
    return () => window.removeEventListener("deviceorientation", updateHeading, true);
  }, [motionEnabled]);

  const enableMotionGuide = async () => {
    setMotionError("");
    try {
      const orientationApi = DeviceOrientationEvent as typeof DeviceOrientationEvent & { requestPermission?: () => Promise<"granted" | "denied"> };
      if (orientationApi.requestPermission && await orientationApi.requestPermission() !== "granted") throw new Error("Motion permission was denied.");
      setMotionEnabled(true);
    } catch (error) {
      setMotionError(error instanceof Error ? error.message : "The angle guide is unavailable.");
    }
  };

  const createPreview = (file: File) => {
    setOptionsOpen(false);
    clearPreview();
    const url = URL.createObjectURL(file);
    previewUrlRef.current = url;
    setPreview({ file, url });
    stopCamera();
  };

  const capture = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight || saving) {
      setCaptureError("The camera is still preparing. Wait a moment and try again.");
      return;
    }
    setCaptureError("");
    try {
      const canvas = document.createElement("canvas");
      const rotateToLandscape = isLandscape && video.videoHeight > video.videoWidth;
      canvas.width = rotateToLandscape ? video.videoHeight : video.videoWidth;
      canvas.height = rotateToLandscape ? video.videoWidth : video.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("The camera frame could not be prepared.");
      if (rotateToLandscape) {
        const counterClockwise = screen.orientation?.angle === 270;
        context.translate(canvas.width / 2, canvas.height / 2);
        context.rotate(counterClockwise ? -Math.PI / 2 : Math.PI / 2);
        context.drawImage(video, -video.videoWidth / 2, -video.videoHeight / 2);
      } else {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
      }
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      if (!blob) throw new Error("The camera frame could not be saved.");
      createPreview(new File([blob], `capture-${captureView}-${imageNumber}-${Date.now()}.jpg`, { type: "image/jpeg", lastModified: Date.now() }));
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : "The image could not be captured.");
    }
  };

  const acceptPhoto = async () => {
    if (!preview || saving) return;
    try {
      setSaving(true);
      setCaptureError("");
      const accepted = await onCapture(preview.file, heading ?? undefined);
      if (accepted === false) {
        setCaptureError("This photo was not accepted. Keep landscape framing and follow the selected view’s capture guide.");
        setSaving(false);
        return;
      }
      clearPreview();
      onClose();
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : "The photo could not be added.");
      setSaving(false);
    }
  };

  const retake = async () => {
    clearPreview();
    await startCamera(devices[deviceIndex]?.deviceId);
  };

  const switchCamera = async () => {
    if (devices.length < 2) return;
    const next = (deviceIndex + 1) % devices.length;
    setDeviceIndex(next);
    await startCamera(devices[next].deviceId);
  };

  const close = () => {
    stopCamera();
    clearPreview();
    onClose();
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await dialogRef.current?.requestFullscreen();
    } catch {
      setMotionError("Fullscreen is unavailable, but capture will still work.");
    }
  };

  return (
    <div ref={dialogRef} className="fixed inset-0 z-[100] flex h-dvh w-screen items-center justify-center bg-black" role="dialog" aria-modal="true" aria-label={`Capture image ${imageNumber}`}>
      <div className={styles.camera}>
        <header className={styles.header}>
          <h2 className={styles.title}>{preview ? "Review photo" : `Photo ${imageNumber}`}<span> · {CAPTURE_GUIDE[captureView].label}</span></h2>
          <button type="button" onClick={close} aria-label="Close camera" className={styles.iconButton}><X size={20} /></button>
        </header>

        <div className={styles.viewfinder}>
          {preview ? <img src={preview.url} alt="Captured photo preview" className={styles.media} /> : <video ref={videoRef} playsInline muted autoPlay className={styles.media} />}
          {starting && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950"><LoaderCircle className="animate-spin text-blue-300" size={32} /><p className="text-sm text-white/70">Starting camera…</p></div>}
          {!preview && cameraReady && <>
            {motionEnabled && <>
              <div className="pointer-events-none absolute inset-y-0 left-1/4 border-l border-dashed border-white/25" />
              <div className="pointer-events-none absolute inset-y-0 right-1/4 border-r border-dashed border-white/25" />
            </>}
            <div className={styles.hint}>
              {captureView === "top" ? <ArrowUp size={18} /> : captureView === "bottom" ? <ArrowDown size={18} /> : motionEnabled && turn != null ? Math.abs(turn) <= 12 ? <Check size={18} className="text-emerald-300" /> : turn > 0 ? <ArrowRight size={18} /> : <ArrowLeft size={18} /> : null}
              <p>{captureView !== "around" ? CAPTURE_GUIDE[captureView].title : motionEnabled && turn != null ? angleReady ? "Angle ready · hold steady" : `Turn ${Math.round(Math.abs(turn))}° · keep 30–50% overlap` : imageNumber === 1 ? "Keep level · choose a starting view" : "Keep level · overlap the previous photo by 30–50%"}{pitch != null && ` · Tilt ${pitch}°`}</p>
            </div>
          </>}
          {!starting && !preview && !cameraReady && <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center"><span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10"><CameraIcon size={30} /></span><p role="alert" className="mt-5 max-w-md text-sm leading-6 text-red-200">{cameraError}</p><button type="button" onClick={() => void startCamera()} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-900"><RefreshCcw size={17} />Retry live camera</button></div>}
        </div>

        <footer className={styles.controls}>
          {preview ? <>
            <button type="button" onClick={() => void retake()} disabled={saving} className={styles.secondaryAction}><RotateCcw size={20} /><span>Retake</span></button>
            <button type="button" onClick={() => void acceptPhoto()} disabled={saving} className={styles.acceptAction}>{saving ? <LoaderCircle className="animate-spin" size={24} /> : <Check size={24} />}<span>{saving ? "Adding…" : "Use photo"}</span></button>
          </> : <>
            <button ref={optionsButtonRef} type="button" onClick={() => setOptionsOpen(!optionsOpen)} aria-label="Camera options and tips" aria-expanded={optionsOpen} aria-controls="phone-camera-options" className={styles.secondaryAction}><MoreHorizontal size={24} /><span>Options</span></button>
            <button type="button" onClick={() => void capture()} disabled={starting || saving || !cameraReady} aria-label="Capture photo" className={styles.shutter}><Camera size={28} /><span className="sr-only">Capture</span></button>
            {devices.length > 1 && <button type="button" onClick={() => void switchCamera()} disabled={starting} aria-label="Switch camera" className={styles.secondaryAction}><SwitchCamera size={24} /><span>Flip</span></button>}
          </>}
        </footer>

        {!preview && optionsOpen && <>
          <button type="button" className={styles.backdrop} aria-label="Dismiss camera options" onClick={() => { setOptionsOpen(false); optionsButtonRef.current?.focus(); }} />
          <section id="phone-camera-options" aria-label="Camera options and tips" className={styles.options}>
            <div className="flex items-center justify-between gap-4"><h3 className="text-sm font-semibold">Camera options</h3><button type="button" aria-label="Close camera options" onClick={() => { setOptionsOpen(false); optionsButtonRef.current?.focus(); }} className={styles.iconButton}><X size={18} /></button></div>
            <p className="text-xs leading-relaxed text-white/65">{CAPTURE_GUIDE[captureView].direction}</p>
            <button type="button" onClick={() => motionEnabled ? setMotionEnabled(false) : void enableMotionGuide()} className={styles.optionAction} aria-pressed={motionEnabled}><Compass size={18} />{motionEnabled ? "Turn off angle / tilt guide" : "Enable angle / tilt guide"}</button>
            <p className="text-xs text-white/50">The angle guide is optional and does not verify coverage.</p>
            <button type="button" onClick={() => void toggleFullscreen()} className={styles.optionAction}>{isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}{isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}</button>
            <label className={styles.optionAction}><Upload size={18} />Use phone camera<input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) createPreview(file); event.currentTarget.value = ""; }} /></label>
          </section>
        </>}

        {(captureError || motionError || (!preview && !isLandscape) || (!preview && !starting && !cameraReady)) && <div className={styles.feedback}>
          {captureError && <p role="alert" className="text-red-200">{captureError}</p>}
          {motionError && <p role="status" className="text-amber-200">{motionError} You can continue without it.</p>}
          {!preview && !isLandscape && <p className="text-amber-200">Rotate your phone to landscape for a wider photo.</p>}
          {!preview && !starting && !cameraReady && <label className={styles.optionAction}><Upload size={18} />Use phone camera<input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) createPreview(file); event.currentTarget.value = ""; }} /></label>}
        </div>}
      </div>
    </div>
  );
}
