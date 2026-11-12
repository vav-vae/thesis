"use client";

/* eslint-disable @next/next/no-img-element -- The review image is a temporary local blob URL. */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Camera, CameraIcon, Check, Compass, LoaderCircle, Maximize2, Minimize2, MoreHorizontal, RefreshCcw, RotateCcw, SwitchCamera, Upload, X } from "lucide-react";
import { CAPTURE_GUIDE, CAPTURE_VIEWS, CAPTURE_STEPS, CAPTURE_TURN_STEP, MIN_CAPTURE_IMAGES, MAX_CAPTURE_IMAGES, captureStepId, captureAlignment, retakeAlignment, rearCameraHeading, rearCameraPitch, type CaptureShotContext, type CaptureStepId, type CapturePhase, type CaptureView } from "@/lib/capture-guide";
import styles from "./PhoneCameraCapture.module.css";
import CapturedPhotoPreview, { LocalCaptureImage } from "./CapturedPhotoPreview";

type PhoneCameraCaptureProps = {
  imageNumber: number;
  replacement?: { total: number; phase: CapturePhase; original: File; target?: CaptureShotContext };
  captureView?: CaptureView;
  onCaptureViewChange?: (view: CaptureView) => void;
  onCapture: (file: File, heading?: number, context?: CaptureShotContext) => void | boolean | Promise<void | boolean>;
  captureProgress?: Partial<Record<CaptureStepId, number>>;
  onClose: () => void;
  onFinish?: () => void;
  onDebug?: (message: string, detail?: string) => void;
};

function cameraMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (!window.isSecureContext) return "Live camera requires HTTPS. Open the deployed HTTPS site on your phone, or use “Use phone camera” below.";
  if (name === "NotAllowedError" || name === "SecurityError") return "Camera access is blocked. Allow camera permission in your browser or site settings, then retry.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "No camera was found on this device.";
  if (name === "NotReadableError" || name === "TrackStartError") return "The camera is already in use by another app. Close it there, then retry.";
  if (name === "OverconstrainedError") return "This camera does not support the requested mode. Retry with another camera.";
  return "The live camera could not start. Retry or use your phone’s native camera.";
}

export default function PhoneCameraCapture({ imageNumber, captureView = "around", onCaptureViewChange, onCapture, onClose, onFinish, onDebug, captureProgress = {}, replacement }: PhoneCameraCaptureProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraRequestRef = useRef(0);
  const previewUrlRef = useRef("");
  const captureBusyRef = useRef(false);
  const [starting, setStarting] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [captureError, setCaptureError] = useState("");
  const [motionError, setMotionError] = useState("");
  const [orientation, setOrientation] = useState<{ heading: number | null; pitch: number | null; absoluteHeading: boolean; time: number } | null>(null);
  const [sensorClock, setSensorClock] = useState(0);
  const [previousHeadings, setPreviousHeadings] = useState<Partial<Record<`${CaptureView}:${CapturePhase}`, number | null>>>({});
  const [capturePhase, setCapturePhase] = useState<CapturePhase>(replacement?.phase ?? "bridge");
  const [rearFacing, setRearFacing] = useState(true);
  const [motionEnabled, setMotionEnabled] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceIndex, setDeviceIndex] = useState(0);
  const [preview, setPreview] = useState<{ file: File; url: string; heading: number | null; pitch: number | null; absoluteHeading: boolean } | null>(null);
  const [reviewEveryPhoto, setReviewEveryPhoto] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const [savedPhoto, setSavedPhoto] = useState<{ file: File; number: number; view: CaptureView; phase: CapturePhase } | null>(null);
  const [showOverlap, setShowOverlap] = useState(true);
  const [guideExpanded, setGuideExpanded] = useState(false);
  const [savedPreviewOpen, setSavedPreviewOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [activeStream, setActiveStream] = useState<MediaStream | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsButtonRef = useRef<HTMLButtonElement>(null);
  const onDebugRef = useRef(onDebug);
  useEffect(() => { onDebugRef.current = onDebug; }, [onDebug]);

  const sensorFresh = motionEnabled && rearFacing && orientation != null && sensorClock - orientation.time < 1500;
  const heading = sensorFresh ? orientation.heading : null;
  const pitch = sensorFresh ? orientation.pitch : null;
  const phase = captureView === "around" ? "ring" : capturePhase;
  const headingKey = `${captureView}:${phase}` as const;
  const alignment = replacement ? retakeAlignment(captureView, phase, pitch, heading, replacement.target, orientation?.absoluteHeading ?? false) : captureAlignment(captureView, phase, pitch, heading, previousHeadings[headingKey] ?? null);
  const angleReady = alignment.ready;
  const targetLabel = captureView === "around" ? "Level row" : phase === "bridge" ? "Connect to the wall row" : phase === "pole" ? captureView === "top" ? "Directly overhead" : "Directly below" : captureView === "top" ? "Ceiling ring" : "Floor ring";
  const savedCount = replacement?.total ?? imageNumber - 1;
  const atLimit = !replacement && savedCount >= MAX_CAPTURE_IMAGES;
  const stepIndex = CAPTURE_STEPS.findIndex((step) => step.id === captureStepId(captureView, phase));
  const currentStep = CAPTURE_STEPS[stepIndex];
  const nextStep = CAPTURE_STEPS[stepIndex + 1];
  const rowCount = captureProgress[currentStep.id] ?? 0;
  const canCompare = savedPhoto && savedPhoto.view === captureView && savedPhoto.phase === phase && phase !== "pole";
  const guideMessage = replacement ? (!motionEnabled ? "Enable Angle guide, or match the original photo visually" : !rearFacing ? "Switch to the rear camera to match the original" : !sensorFresh ? "Waiting for motion data · match the original photo visually" : alignment.message) : !motionEnabled ? (captureView === "around" ? "Keep level · overlap the previous view by 30–50%"
    : phase === "pole" ? `Point ${captureView === "top" ? "directly overhead" : "directly below"} · overlap the ${captureView === "top" ? "ceiling" : "floor"} ring`
    : `Tilt ${captureView === "top" ? "up" : "down"} about ${Math.abs(alignment.targetPitch)}° · overlap the previous row by 30–50%`)
    : !rearFacing ? "Switch to the rear camera for angle guidance"
    : !sensorFresh || pitch == null ? "Waiting for motion data · follow the visual overlap guide"
    : alignment.message;

  const resetHeadings = () => setPreviousHeadings({});

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
      onDebugRef.current?.("Live camera is unavailable in this browser context.", `secureContext=${window.isSecureContext}; getUserMedia=${Boolean(navigator.mediaDevices?.getUserMedia)}; userAgent=${navigator.userAgent}`);
      setCameraError(!window.isSecureContext
        ? "Live camera requires HTTPS. Open the deployed HTTPS site on your phone, or use “Use phone camera” below."
        : "Live camera is unavailable in this browser. Use your phone’s native camera below.");
      setStarting(false);
      return;
    }
    try {
      const videoConstraints: MediaTrackConstraints = requestedDeviceId
        ? { deviceId: { exact: requestedDeviceId }, aspectRatio: { ideal: 4 / 3 }, width: { ideal: 1920 }, height: { ideal: 1440 } }
        : { facingMode: { ideal: "environment" }, aspectRatio: { ideal: 4 / 3 }, width: { ideal: 1920 }, height: { ideal: 1440 } };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints });
      if (request !== cameraRequestRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      setRearFacing(stream.getVideoTracks()[0]?.getSettings().facingMode !== "user");
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
      onDebugRef.current?.("Live camera failed to start.", error instanceof Error ? `${error.name}: ${error.message}\n${error.stack || ""}` : String(error));
      setCameraError(cameraMessage(error));
      setStarting(false);
    }
  }, [stopCamera]);

  useEffect(() => {
    if (!activeStream || !videoRef.current) return;
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
      onDebugRef.current?.("Live camera preview playback failed.", error instanceof Error ? `${error.name}: ${error.message}\n${error.stack || ""}` : String(error));
      setCameraError(cameraMessage(error));
      stopCamera();
      setStarting(false);
    });
    return () => {
      cancelled = true;
      if (video.srcObject === activeStream) video.srcObject = null;
    };
  }, [activeStream, stopCamera]);

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
    let lastUpdate = 0;
    const updateHeading = (event: DeviceOrientationEvent) => {
      const now = Date.now();
      if (now - lastUpdate < 100) return;
      lastUpdate = now;
      setOrientation({ heading: rearCameraHeading(event.alpha, event.beta, event.gamma), pitch: rearCameraPitch(event.beta, event.gamma), absoluteHeading: event.absolute === true, time: now });
      setSensorClock(now);
    };
    const timer = window.setInterval(() => setSensorClock(Date.now()), 500);
    window.addEventListener("deviceorientation", updateHeading, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("deviceorientation", updateHeading, true);
    };
  }, [motionEnabled]);

  const enableMotionGuide = async () => {
    setMotionError("");
    try {
      if (typeof DeviceOrientationEvent === "undefined") throw new Error("Motion sensors are unavailable on this device.");
      const orientationApi = DeviceOrientationEvent as typeof DeviceOrientationEvent & { requestPermission?: () => Promise<"granted" | "denied"> };
      if (orientationApi.requestPermission && await orientationApi.requestPermission() !== "granted") throw new Error("Motion permission was denied.");
      setOrientation(null);
      resetHeadings();
      setMotionEnabled(true);
    } catch (error) {
      setMotionError(error instanceof Error ? error.message : "The angle guide is unavailable.");
      onDebugRef.current?.("Motion guide could not be enabled.", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    }
  };

  const createPreview = (file: File, capturedHeading: number | null = null, capturedPitch: number | null = null, absoluteHeading = false) => {
    setOptionsOpen(false);
    clearPreview();
    const url = URL.createObjectURL(file);
    previewUrlRef.current = url;
    setPreview({ file, url, heading: capturedHeading, pitch: capturedPitch, absoluteHeading });
  };

  const savePhoto = async (file: File, capturedHeading: number | null, capturedPitch: number | null, absoluteHeading: boolean) => {
    const accepted = await onCapture(file, capturedHeading ?? undefined, { view: captureView, phase, pitch: capturedPitch, heading: capturedHeading, absoluteHeading });
    if (accepted === false) throw new Error("This photo was not accepted. Follow the selected view’s capture guide and try again.");
    if (phase !== "pole") setPreviousHeadings((previous) => ({ ...previous, [headingKey]: capturedHeading }));
    setSavedMessage(`Photo ${imageNumber} saved · continue capturing`);
    setSavedPhoto({ file, number: imageNumber, view: captureView, phase });
    clearPreview();
  };

  const capture = async () => {
    const video = videoRef.current;
    if (captureBusyRef.current) return;
    if (atLimit) { setCaptureError("64 photos saved. Review the set and remove an unwanted photo before adding more."); return; }
    if (!video || !video.videoWidth || !video.videoHeight) {
      setCaptureError("The camera is still preparing. Wait a moment and try again.");
      return;
    }
    setCaptureError("");
    setSavedMessage("");
    // Snapshot the lens heading before JPEG encoding or review can move it.
    const capturedHeading = sensorFresh && orientation && Date.now() - orientation.time < 1500 ? heading : null;
    const absoluteHeading = orientation?.absoluteHeading === true;
    const capturedPitch = sensorFresh && orientation && Date.now() - orientation.time < 1500 ? pitch : null;
    const request = cameraRequestRef.current;
    captureBusyRef.current = true;
    setSaving(true);
    let capturedFile: File | null = null;
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
      if (request !== cameraRequestRef.current) return;
      if (!blob) throw new Error("The camera frame could not be saved.");
      capturedFile = new File([blob], `capture-${captureView}-${imageNumber}-${Date.now()}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
      if (replacement || reviewEveryPhoto) createPreview(capturedFile, capturedHeading, capturedPitch, absoluteHeading);
      else await savePhoto(capturedFile, capturedHeading, capturedPitch, absoluteHeading);
    } catch (error) {
      if (capturedFile) createPreview(capturedFile, capturedHeading, capturedPitch, absoluteHeading);
      onDebugRef.current?.("Live camera photo capture failed.", error instanceof Error ? `${error.name}: ${error.message}\n${error.stack || ""}` : String(error));
      setCaptureError(error instanceof Error ? error.message : "The image could not be captured.");
    } finally {
      captureBusyRef.current = false;
      setSaving(false);
    }
  };

  const acceptPhoto = async () => {
    if (!preview || captureBusyRef.current) return;
    captureBusyRef.current = true;
    try {
      setSaving(true);
      setCaptureError("");
      await savePhoto(preview.file, preview.heading, preview.pitch, preview.absoluteHeading);
    } catch (error) {
      onDebugRef.current?.("Captured photo could not be added to the tour.", error instanceof Error ? `${error.name}: ${error.message}\n${error.stack || ""}` : String(error));
      setCaptureError(error instanceof Error ? error.message : "The photo could not be added.");
    } finally {
      captureBusyRef.current = false;
      setSaving(false);
    }
  };

  const retake = async () => {
    setCaptureError("");
    clearPreview();
    if (!streamRef.current) await startCamera(devices[deviceIndex]?.deviceId);
  };

  const switchCamera = async () => {
    if (devices.length < 2) return;
    const next = (deviceIndex + 1) % devices.length;
    setDeviceIndex(next);
    resetHeadings();
    await startCamera(devices[next].deviceId);
  };

  const close = () => {
    if (captureBusyRef.current) return;
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
          <div className={styles.titleBlock}>
            <p className={styles.eyebrow}>Live capture <span aria-hidden="true">·</span> {savedCount}/{MAX_CAPTURE_IMAGES} saved</p>
            <h2 className={styles.title}>{preview ? "Review photo" : `${replacement ? "Retake photo" : "Photo"} ${imageNumber}`}<span> · {CAPTURE_GUIDE[captureView].label}</span></h2>
          </div>
          <div className={styles.headerActions}>
            {savedPhoto && <button type="button" disabled={saving} aria-label="Preview last photo" title="Preview last photo" onClick={() => setSavedPreviewOpen(true)} className={styles.lastPhoto}><LocalCaptureImage file={savedPhoto.file} alt="Last saved photo" className="size-full object-cover" /><span className="absolute inset-x-0 bottom-0 bg-black/70 text-[9px] text-white">Preview</span></button>}
            <button type="button" onClick={close} disabled={saving || (!replacement && preview != null)} className={styles.doneAction}>{replacement ? "Cancel retake" : "Review photos"}</button>
          </div>
        </header>

        <div className={styles.viewfinder}>
          <video ref={videoRef} playsInline muted autoPlay className={styles.media} style={{ visibility: preview ? "hidden" : "visible" }} />
          {preview && <img src={preview.url} alt="Captured photo preview" className={`${styles.media} absolute inset-0`} />}
          {starting && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950"><LoaderCircle className="animate-spin text-blue-300" size={32} /><p className="text-sm text-white/70">Starting camera…</p></div>}
          {!preview && cameraReady && <>
            {replacement && showOverlap && <div className={styles.retakeGuide} aria-hidden="true"><LocalCaptureImage file={replacement.original} alt="" className={styles.retakeImage} /><span>Original photo · align the same details</span></div>}
            {canCompare && showOverlap && <div className={styles.overlapGuide} aria-hidden="true"><LocalCaptureImage file={savedPhoto.file} alt="" className={styles.overlapImage} /><span>Previous photo edge</span></div>}
            {motionEnabled && <>
              <div className="pointer-events-none absolute inset-y-0 left-1/4 border-l border-dashed border-white/25" />
              <div className="pointer-events-none absolute inset-y-0 right-1/4 border-r border-dashed border-white/25" />
            </>}
            {motionEnabled && sensorFresh && pitch != null && <div className={styles.alignmentTarget} data-ready={angleReady} aria-hidden="true">
              <span className={styles.targetRing} />
              <span className={styles.targetDot} style={{ transform: `translate(${Math.max(-70, Math.min(70, (alignment.turn ?? 0) * 2))}px, ${Math.max(-70, Math.min(70, -(alignment.pitchError ?? 0) * 2))}px)` }} />
            </div>}
            <div className={styles.hint}>
              {angleReady ? <Check size={18} className="text-emerald-300" /> : alignment.direction === "up" ? <ArrowUp size={18} /> : alignment.direction === "down" ? <ArrowDown size={18} /> : alignment.direction === "right" ? <ArrowRight size={18} /> : alignment.direction === "left" ? <ArrowLeft size={18} /> : null}
              <p>{guideMessage}{pitch != null && ` · Tilt ${Math.round(pitch)}°`}</p>
            </div>
          </>}
          {!starting && !preview && !cameraReady && <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center"><span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10"><CameraIcon size={30} /></span><p role="alert" className="mt-5 max-w-md text-sm leading-6 text-red-200">{cameraError}</p><button type="button" onClick={() => void startCamera()} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-900"><RefreshCcw size={17} />Retry live camera</button></div>}
        </div>

        {!preview && <div className={styles.sessionBar} data-expanded={guideExpanded}>
          <div className={styles.sessionIntro}>
            <p className={styles.stepLabel}>{replacement ? "Retake · original capture row" : `Step ${stepIndex + 1}/7 · ${rowCount}/${currentStep.target} guide shots`}</p>
            {!motionEnabled && <button type="button" onClick={() => void enableMotionGuide()} className={styles.guideAction}><Compass size={15} />Angle guide</button>}
          </div>
          <div className={styles.captureTrack} aria-label="Capture sequence">{CAPTURE_STEPS.map((step, index) => <span key={step.id} data-active={index === stepIndex} data-done={(captureProgress[step.id] ?? 0) >= step.target} title={`${step.label}: ${captureProgress[step.id] ?? 0} shots`} />)}</div>
          <p className={styles.currentRow}>{replacement ? `${currentStep.label} · target ${Math.round(alignment.targetPitch)}°` : currentStep.label}</p>
          {onCaptureViewChange && <div className={styles.viewChoices} role="group" aria-label="Photo type">
            {CAPTURE_VIEWS.map((view) => <button key={view} type="button" disabled={saving} aria-pressed={captureView === view} onClick={() => { setCapturePhase("bridge"); setSavedMessage(""); onCaptureViewChange(view); }}>{CAPTURE_GUIDE[view].label}</button>)}
          </div>}
          {!replacement && captureView !== "around" && <div className={`${styles.viewChoices} ${styles.phaseChoices}`} role="group" aria-label={`${captureView === "top" ? "Ceiling" : "Floor"} capture target`}>
            <button type="button" disabled={saving} aria-pressed={phase === "bridge"} onClick={() => { setCapturePhase("bridge"); setSavedMessage(""); }}>1 · Include wall<br />{captureView === "top" ? "+30°" : "−30°"}</button>
            <button type="button" disabled={saving} aria-pressed={phase === "ring"} onClick={() => { setCapturePhase("ring"); setSavedMessage(""); }}>2 · {captureView === "top" ? "Ceiling" : "Floor"}<br />{captureView === "top" ? "+60°" : "−60°"}</button>
            <button type="button" disabled={saving} aria-pressed={phase === "pole"} onClick={() => { setCapturePhase("pole"); setSavedMessage(""); }}>3 · {captureView === "top" ? "Overhead" : "Below"}<br />{captureView === "top" ? "+90°" : "−90°"}</button>
          </div>}
          <p className={styles.captureTip}>{targetLabel} · aim for {alignment.targetPitch}°{captureView !== "around" && (phase === "bridge" ? " · keep wall detail in view" : phase === "ring" ? " · overlap the 30° row" : " · overlap the 60° row")}</p>
          <div className={styles.rowActions}>
            <button type="button" hidden={!!replacement} className={styles.guideToggle} aria-expanded={guideExpanded} onClick={() => setGuideExpanded(!guideExpanded)}>{guideExpanded ? "Hide" : "Show"} row settings</button>
            {(canCompare || replacement) && <button type="button" aria-pressed={showOverlap} onClick={() => setShowOverlap(!showOverlap)}>{replacement ? "Original overlay" : "Overlap guide"} {showOverlap ? "on" : "off"}</button>}
            {nextStep && onCaptureViewChange && <button type="button" disabled={saving} onClick={() => { setCapturePhase(nextStep.phase); setSavedMessage(""); onCaptureViewChange(nextStep.view); }}>Next row: {nextStep.label} →</button>}
          </div>
          <p className={styles.captureCaution}>{replacement ? "Return to the original lens position. The original stays until you choose Replace photo." : atLimit ? "Photo limit reached. Review this set before generating." : "Counts guide your sequence, not verified coverage. Keep the lens fixed, move slowly, and keep shared detail between rows."}</p>
          {!isLandscape && <p className={styles.orientationNote}>Rotate your phone to landscape for a wider photo.</p>}
          <div className={styles.sessionNext}>
            <p role="status">{saving ? "Saving photo…" : replacement ? "Capture the same view, then review your replacement." : savedMessage || (savedCount < MIN_CAPTURE_IMAGES ? `${MIN_CAPTURE_IMAGES - savedCount} more photo${MIN_CAPTURE_IMAGES - savedCount === 1 ? "" : "s"} to reach the minimum` : onFinish ? "Ready to check and build your tour" : "Review photos to check the set")}</p>
            {onFinish && <button type="button" disabled={saving} onClick={() => { if (captureBusyRef.current) return; stopCamera(); clearPreview(); onFinish(); }} className={styles.finishAction}><Check size={17} />Finish &amp; generate</button>}
          </div>
        </div>}
        <footer className={styles.controls}>
          {preview ? <>
            <button type="button" onClick={() => void retake()} disabled={saving} className={styles.secondaryAction}><RotateCcw size={20} /><span>Retake</span></button>
            <button type="button" onClick={() => void acceptPhoto()} disabled={saving} className={styles.acceptAction}>{saving ? <LoaderCircle className="animate-spin" size={24} /> : <Check size={24} />}<span>{saving ? "Saving…" : replacement ? "Replace photo" : "Use & next"}</span></button>
          </> : <>
            <button ref={optionsButtonRef} type="button" onClick={() => setOptionsOpen(!optionsOpen)} aria-label="Camera options and tips" aria-expanded={optionsOpen} aria-controls="phone-camera-options" className={styles.secondaryAction}><MoreHorizontal size={24} /><span>Options</span></button>
            <button type="button" onClick={() => void capture()} disabled={starting || saving || !cameraReady || atLimit} aria-label="Capture photo" className={styles.shutter}>{saving ? <LoaderCircle className="animate-spin" size={28} /> : <Camera size={28} />}<span className="sr-only">Capture</span></button>
            {devices.length > 1 && <button type="button" onClick={() => void switchCamera()} disabled={starting || saving} aria-label="Switch camera" className={styles.secondaryAction}><SwitchCamera size={24} /><span>Flip</span></button>}
          </>}
        </footer>

        {!preview && optionsOpen && <>
          <button type="button" className={styles.backdrop} aria-label="Dismiss camera options" onClick={() => { setOptionsOpen(false); optionsButtonRef.current?.focus(); }} />
          <section id="phone-camera-options" aria-label="Camera options and tips" className={styles.options}>
            <div className="flex items-center justify-between gap-4"><h3 className="text-sm font-semibold">Camera options</h3><button type="button" aria-label="Close camera options" onClick={() => { setOptionsOpen(false); optionsButtonRef.current?.focus(); }} className={styles.iconButton}><X size={18} /></button></div>
            <p className="text-xs leading-relaxed text-white/65">{CAPTURE_GUIDE[captureView].direction}</p>
            <button type="button" onClick={() => { resetHeadings(); if (motionEnabled) setMotionEnabled(false); else void enableMotionGuide(); }} className={styles.optionAction} aria-pressed={motionEnabled}><Compass size={18} />{motionEnabled ? "Turn off angle / tilt guide" : "Enable angle / tilt guide"}</button>
            <p className="text-xs text-white/50">Turns use an estimated {CAPTURE_TURN_STEP}° spacing. Check 30–50% overlap visually. Complete the 30° row, then 60°, then directly up/down; keep shared detail between rows.</p>
            <label className={styles.optionAction}><input type="checkbox" disabled={!!replacement} checked={!!replacement || reviewEveryPhoto} onChange={(event) => setReviewEveryPhoto(event.target.checked)} />Review every photo before saving</label>
            <button type="button" onClick={() => void toggleFullscreen()} className={styles.optionAction}>{isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}{isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}</button>
            <label className={styles.optionAction}><Upload size={18} />Use phone camera<input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) createPreview(file); event.currentTarget.value = ""; }} /></label>
          </section>
        </>}

        {(captureError || motionError || (!preview && !starting && !cameraReady)) && <div className={styles.feedback}>
          {captureError && <p role="alert" className="text-red-200">{captureError}</p>}
          {motionError && <p role="status" className="text-amber-200">{motionError} You can continue without it.</p>}
          {!preview && !starting && !cameraReady && <label className={styles.optionAction}><Upload size={18} />Use phone camera<input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) createPreview(file); event.currentTarget.value = ""; }} /></label>}
        </div>}
        {savedPreviewOpen && savedPhoto && <CapturedPhotoPreview file={savedPhoto.file} index={savedPhoto.number - 1} total={imageNumber - 1} view={savedPhoto.view} onClose={() => setSavedPreviewOpen(false)} onImageError={() => onDebugRef.current?.("Last photo preview failed.", `Photo ${savedPhoto.number}: ${savedPhoto.file.name}`)} />}
      </div>
    </div>
  );
}
