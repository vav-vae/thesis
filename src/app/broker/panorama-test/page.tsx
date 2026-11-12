"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged } from "firebase/auth";
import { addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import {
  AlertCircle,
  ArrowLeft,
  Bug,
  Camera,
  CheckCircle2,
  ChevronRight,
  Circle,
  Eye,
  ImageIcon,
  Info,
  LoaderCircle,
  RotateCcw,
  Images,
  Trash2,
  UploadCloud,
} from "lucide-react";

import PanoramaViewer from "@/components/PanoramaViewer";
import PhoneCameraCapture from "@/components/PhoneCameraCapture";
import CapturedPhotoPreview, { LocalCaptureImage } from "@/components/CapturedPhotoPreview";
import { auth, db } from "@/lib/firebase";
import { useTourGenerationJob } from "@/hooks/useTourGenerationJob";
import { recordTourLog } from "@/lib/tour-logs";
import { HttpResponseError, readJsonResponse } from "@/lib/http-response";
import { formatCaptureDiagnostic, sanitizeDiagnosticText, type CaptureDiagnosticContext } from "@/lib/capture-diagnostics";
import { cachedPromise, mapWithConcurrency } from "@/lib/promise-cache";
import { CAPTURE_GUIDE, CAPTURE_VIEWS, MIN_CAPTURE_IMAGES, type CaptureView } from "@/lib/capture-guide";
import {
  isRemoteImageUrl,
  uploadImageToCloudinary,
  uploadPanoramaSourceToCloudinary,
  CLOUDINARY_UPLOAD_URL,
} from "@/lib/cloudinary";
import {
  panoramaApiError,
  panoramaApiFetch,
  tourGenerationResult,
  type TourGenerationJob,
  PANORAMA_API_URL,
  type HybridMetadata,
} from "@/lib/panorama-api";

type StitchMetrics = Partial<HybridMetadata> & { output_width: number; output_height: number; processing_ms?: number; coverage_ratio?: number };

type PropertyOption = { id: string; title?: string };
type QualityIssue = { severity: "warning" | "error"; code: string; message: string };
type Validation = { file: File; width: number; height: number; blurScore?: number; brightness?: number; keypoints?: number; issues: QualityIssue[] };
type PairValidation = { fromIndex: number; toIndex: number; goodMatches: number; inliers: number; inlierRatio: number; issues: QualityIssue[] };
type UploadedSource = { file: File; url: string };
type Stage = "details" | "images" | "preview" | "publish";
type DevLogEntry = { id: number; time: string; level: "info" | "error"; message: string; detail?: string };

const DEVELOPMENT_LOGS_ENABLED = process.env.NODE_ENV !== "production";

const stages: { id: Stage; label: string }[] = [
  { id: "details", label: "Room details" },
  { id: "images", label: "Add images" },
  { id: "preview", label: "Review tour" },
  { id: "publish", label: "Publish" },
];

function inspectImage(file: File): Promise<Validation> {
  return new Promise((resolve) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      const issues: QualityIssue[] = [];
      if (image.width <= image.height) issues.push({ severity: "error", code: "client_portrait", message: "Portrait images are not accepted. Rotate your phone and capture in landscape mode." });
      if (image.width < 1280 || image.height < 720) issues.push({ severity: "warning", code: "client_resolution", message: "Low resolution; use at least 1280×720." });
      if (file.size > 12 * 1024 * 1024) issues.push({ severity: "error", code: "client_size", message: "File is larger than 12 MB." });
      if (file.size < 80 * 1024) issues.push({ severity: "warning", code: "client_small", message: "Very small file; detail may be insufficient." });
      URL.revokeObjectURL(url);
      resolve({ file, width: image.width, height: image.height, issues });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ file, width: 0, height: 0, issues: [{ severity: "error", code: "client_decode", message: "This image could not be read." }] });
    };
    image.src = url;
  });
}

export default function CreateVirtualTourPage() {
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [propertiesLoading, setPropertiesLoading] = useState(true);
  const [selectedProperty, setSelectedProperty] = useState("");
  const [roomType, setRoomType] = useState("");
  const [brokerId, setBrokerId] = useState("");
  const algorithm = "sift" as const;
  const [ransacThreshold, setRansacThreshold] = useState(4);
  const [files, setFiles] = useState<File[]>([]);
  const [captureView, setCaptureView] = useState<CaptureView>("around");
  const [validationStage, setValidationStage] = useState("");
  const [captureViews, setCaptureViews] = useState<Map<File, CaptureView>>(new Map());
  const [uploadedSources, setUploadedSources] = useState<UploadedSource[]>([]);
  const [validations, setValidations] = useState<Validation[]>([]);
  const [pairValidations, setPairValidations] = useState<PairValidation[]>([]);
  const [analysisIssues, setAnalysisIssues] = useState<QualityIssue[]>([]);
  const [preflightPassed, setPreflightPassed] = useState(false);
  const [validating, setValidating] = useState(false);
  const [panorama, setPanorama] = useState("");
  const [aiMaskUrl, setAiMaskUrl] = useState("");
  const [metrics, setMetrics] = useState<StitchMetrics | null>(null);
  const tourJob = useTourGenerationJob(brokerId);
  const generating = tourJob.active;
  const [restoredInput, setRestoredInput] = useState<TourGenerationJob["input"] | null>(null);
  const generationStage = tourJob.connection || tourJob.job?.stage || "Starting background job";
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [error, setError] = useState("");
  const [validationFailed, setValidationFailed] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [previewedFile, setPreviewedFile] = useState<File | null>(null);
  const [debugLogsEnabled, setDebugLogsEnabled] = useState(DEVELOPMENT_LOGS_ENABLED);
  const [devLogsOpen, setDevLogsOpen] = useState(true);
  const [devLogs, setDevLogs] = useState<DevLogEntry[]>([]);
  const filesRef = useRef<File[]>([]);
  const captureViewsRef = useRef(new Map<File, CaptureView>());
  const uploadCacheRef = useRef(new Map<File, Promise<string>>());
  const uploadOwnerRef = useRef("");
  const inspectionCacheRef = useRef(new Map<File, Promise<Validation>>());
  const captureSessionDirtyRef = useRef(false);
  const workflowRevisionRef = useRef(0);
  const thresholdValidationPendingRef = useRef(false);
  const generatingRef = useRef(false);
  const publishingRef = useRef(false);
  const devLogIdRef = useRef(0);
  const logListRef = useRef<HTMLDivElement>(null);
  const logPropertyRef = useRef("");

  useEffect(() => {
    const job = tourJob.job;
    if (job?.status !== "completed") return;
    let disposed = false;
    void Promise.resolve().then(() => {
      if (disposed) return;
      const result = tourGenerationResult(job);
      setSelectedProperty(job.input.property_id);
      setRoomType(job.input.room_type);
      setRansacThreshold(job.input.ransac_threshold);
      setRestoredInput(job.input);
      setPanorama(result.panoramaUrl);
      setAiMaskUrl(result.aiMaskUrl);
      setMetrics(result.metadata);
      setPublished(false);
    });
    return () => { disposed = true; };
  }, [tourJob.job]);

  useEffect(() => { logPropertyRef.current = selectedProperty; }, [selectedProperty]);

  useEffect(() => {
    if (panorama) document.getElementById("generated-tour-preview")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [panorama]);

  useEffect(() => {
    const list = logListRef.current;
    if (devLogsOpen && list) list.scrollTop = list.scrollHeight;
  }, [devLogs, devLogsOpen]);

  const addDevLog = useCallback((level: DevLogEntry["level"], message: string, detail?: string) => {
    recordTourLog(level, message, detail, logPropertyRef.current);
    if (!debugLogsEnabled) return;
    const entry = { id: ++devLogIdRef.current, time: new Date().toLocaleTimeString(), level, message: sanitizeDiagnosticText(message), detail: detail ? sanitizeDiagnosticText(detail) : undefined };
    setDevLogs((previous) => [...previous.slice(-79), entry]);
    if (level === "error") setDevLogsOpen(true);
    if (level === "error") console.error(`[Create tour] ${entry.message}`, entry.detail || "");
    else console.info(`[Create tour] ${entry.message}`, entry.detail || "");
  }, [debugLogsEnabled]);

  const reportError = useCallback((stage: string, failure: unknown, context: Omit<CaptureDiagnosticContext, "stage"> = {}) => {
    const reason = failure instanceof Error ? failure.message : String(failure);
    addDevLog("error", `${stage} failed: ${reason}`, formatCaptureDiagnostic(failure, { stage, online: navigator.onLine, ...context }));
  }, [addDevLog]);

  const updateCaptureView = (file: File, view: CaptureView) => {
    const next = new Map(captureViewsRef.current).set(file, view);
    captureViewsRef.current = next;
    setCaptureViews(next);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (new URLSearchParams(window.location.search).get("debug") === "1") setDebugLogsEnabled(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => onAuthStateChanged(auth, async (user) => {
    if (!user) {
      setPropertiesLoading(false);
      return;
    }
    setBrokerId(user.uid);
    try {
      const [snapshot, profileSnapshot] = await Promise.all([
        getDocs(query(collection(db, "properties"), where("brokerId", "==", user.uid))),
        getDoc(doc(db, "users", user.uid)),
      ]);
      setProperties(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as PropertyOption)));
      const tourDefaults = profileSnapshot.data()?.settings?.virtualTours;
      if (Number(tourDefaults?.ransacThreshold) >= 1 && Number(tourDefaults?.ransacThreshold) <= 10) setRansacThreshold(Number(tourDefaults.ransacThreshold));
    } catch (loadError) {
      console.error("Unable to load properties:", loadError);
      reportError("Load properties and tour settings", loadError, { endpoint: "Firestore: properties / users", method: "READ" });
      setError("Your properties could not be loaded. Check your connection and permissions.");
    } finally {
      setPropertiesLoading(false);
    }
  }), [reportError]);

  const currentStage: Stage = published ? "publish" : panorama ? "preview" : files.length ? "images" : "details";
  const currentIndex = stages.findIndex((stage) => stage.id === currentStage);
  const allIssues = [...validations.flatMap((item) => item.issues), ...pairValidations.flatMap((pair) => pair.issues), ...analysisIssues];
  const blockingIssues = allIssues.filter((issue) => issue.severity === "error").length;
  const sourcesMatchFiles = uploadedSources.length === files.length
    && uploadedSources.every((source, index) => source.file === files[index]);
  const sourceImageUrls = restoredInput?.image_urls ?? uploadedSources.map((source) => source.url);
  const sourceCaptureViews = restoredInput?.capture_views ?? files.map((file) => captureViews.get(file) ?? "around");
  const previewIndex = previewedFile ? files.indexOf(previewedFile) : -1;
  const previewValidation = validations.find((item) => item.file === previewedFile);
  const readyToGenerate = Boolean(selectedProperty && roomType.trim() && files.length >= MIN_CAPTURE_IMAGES && sourcesMatchFiles && preflightPassed && !validating && !blockingIssues);
  const quality = useMemo(() => {
    if (!metrics) return null;
    const score = metrics.reconstruction_confidence ?? metrics.coverage_ratio ?? metrics.average_inlier_ratio ?? 0;
    return score >= 0.55 ? { label: "Strong reconstruction", style: "bg-emerald-50 text-emerald-700" }
      : score >= 0.3 ? { label: "Usable — review seams", style: "bg-amber-50 text-amber-700" }
        : { label: "Recapture recommended", style: "bg-red-50 text-red-700" };
  }, [metrics]);

  const validateFiles = async (
    selected: File[],
    selectedAlgorithm: "orb" | "sift",
    selectedRansacThreshold: number,
    revision: number,
    checkOverlap = true,
  ) => {
    addDevLog("info", `Photo validation started (${selected.length} image${selected.length === 1 ? "" : "s"}).`);
    setValidating(true);
    setValidationStage(`Preparing ${selected.length} photos…`);
    setValidationFailed(false);
    const localResults = await Promise.all(selected.map((file) => cachedPromise(inspectionCacheRef.current, file, () => inspectImage(file))));
    if (revision !== workflowRevisionRef.current) return;
    setValidations(localResults);
    setPairValidations([]);
    if (selected.length < MIN_CAPTURE_IMAGES) {
      setValidating(false);
      return;
    }
    if (localResults.some((result) => result.issues.some((issue) => issue.severity === "error"))) {
      localResults.forEach((result, photoIndex) => result.issues.filter((issue) => issue.severity === "error").forEach((issue) => reportError("Photo inspection", Object.assign(new Error(issue.message), { code: issue.code }), { file: result.file, photoIndex, photoCount: selected.length, dimensions: `${result.width}×${result.height}` })));
      setValidating(false);
      return;
    }
    let validationStep = "account check";
    try {
      await auth.authStateReady();
      const user = auth.currentUser;
      if (!user) throw Object.assign(new Error("Sign in before uploading panorama sources."), { code: "AUTH_REQUIRED" });
      if (uploadOwnerRef.current !== user.uid) {
        uploadCacheRef.current.clear();
        uploadOwnerRef.current = user.uid;
      }
      if (revision !== workflowRevisionRef.current) return;
      validationStep = "photo upload";
      let completedUploads = 0;
      setValidationStage(`Uploading photos · 0 of ${selected.length}`);
      addDevLog("info", `Uploading ${selected.length} panorama source image${selected.length === 1 ? "" : "s"} to Cloudinary.`);
      const sources = await mapWithConcurrency(selected, 3, async (file, photoIndex) => {
        const uploadStarted = Date.now();
        try {
          const cached = uploadCacheRef.current.has(file);
          const url = await cachedPromise(uploadCacheRef.current, file, () => uploadPanoramaSourceToCloudinary(file, user.uid));
          completedUploads += 1;
          if (revision === workflowRevisionRef.current) setValidationStage(`Uploading photos · ${completedUploads} of ${selected.length}`);
          addDevLog("info", `${cached ? "Reused" : "Uploaded"} photo ${photoIndex + 1}/${selected.length}: ${file.name}.`, `Elapsed: ${Math.round(Date.now() - uploadStarted)} ms`);
          return { file, url };
        } catch (uploadError) {
          reportError("Photo upload", uploadError, { file, photoIndex, photoCount: selected.length, endpoint: CLOUDINARY_UPLOAD_URL, durationMs: Date.now() - uploadStarted });
          throw new Error(`Photo ${photoIndex + 1} (${file.name}): ${uploadError instanceof Error ? uploadError.message : "Upload failed"}`, { cause: uploadError });
        }
      });
      addDevLog("info", "Panorama source uploads completed.");
      if (revision !== workflowRevisionRef.current) return;
      setUploadedSources(sources);
      // Generation validates overlap itself. The camera's finish action can
      // upload once and let that same server pass validate and reconstruct.
      if (!checkOverlap) {
        setPreflightPassed(true);
        addDevLog("info", "Photos uploaded. Overlap will be checked in the generation pass.");
        return { sources, passed: true, revision };
      }
      validationStep = "panorama image check";
      setValidationStage(`Checking overlap in ${selected.length} photos…`);
      const response = await panoramaApiFetch("/validate/remote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_urls: sources.map((source) => source.url),
          algorithm: selectedAlgorithm,
          ransac_threshold: selectedRansacThreshold,
          capture_views: selected.map((file) => captureViewsRef.current.get(file) ?? "around"),
        }),
      });
      addDevLog(response.ok ? "info" : "error", `Panorama image check returned HTTP ${response.status} ${response.statusText}.`, `Endpoint: ${PANORAMA_API_URL}/validate/remote`);
      if (!response.ok) throw await panoramaApiError(response, "Computer vision preflight failed.");
      const data = await readJsonResponse<{ success: boolean; detail?: string; analysis: { can_stitch: boolean; excluded_image_indices?: number[]; issues: QualityIssue[]; images: { width: number; height: number; blur_score: number; brightness: number; keypoints: number; issues: QualityIssue[] }[]; pairs: { from_index: number; to_index: number; good_matches: number; inliers: number; inlier_ratio: number; issues: QualityIssue[] }[] } }>(response, "Computer vision preflight failed.");
      if (!data.success) throw new HttpResponseError(data.detail || "Computer vision preflight failed.", response);
      if (revision !== workflowRevisionRef.current) return;
      if (!data.analysis || !Array.isArray(data.analysis.images) || data.analysis.images.length !== selected.length || !Array.isArray(data.analysis.pairs) || !Array.isArray(data.analysis.issues)) {
        throw new HttpResponseError(`The panorama processor returned an incomplete validation report for ${selected.length} photos.`, response);
      }
      const matchedImages = new Set(data.analysis.pairs.flatMap((pair) => [pair.from_index, pair.to_index]));
      const excludedImages = new Set(data.analysis.excluded_image_indices ?? []);
      const checked = localResults.map((local, index) => {
        const server = data.analysis.images[index];
        const serverCodes = new Set<string>(server.issues.map((issue: QualityIssue) => issue.code));
        const localOnly = local.issues.filter((issue) => !serverCodes.has(issue.code));
        const overlapIssues: QualityIssue[] = matchedImages.has(index) || excludedImages.has(index) ? [] : [{
          severity: "error",
          code: "image_unconnected",
          message: "No reliable overlap with the other photos. Remove this photo or add a view connecting it to the set.",
        }];
        return { ...local, width: server.width, height: server.height, blurScore: server.blur_score, brightness: server.brightness, keypoints: server.keypoints, issues: [...server.issues, ...overlapIssues, ...localOnly] };
      });
      setValidations(checked);
      checked.forEach((item, photoIndex) => item.issues.filter((issue) => issue.severity === "error").forEach((issue) => reportError("Image quality / overlap", Object.assign(new Error(issue.message), { code: issue.code }), { photoIndex, photoCount: selected.length, file: item.file, dimensions: `${item.width}×${item.height}`, detail: `Sharpness: ${item.blurScore}\nBrightness: ${item.brightness}\nFeatures: ${item.keypoints}` })));
      data.analysis.pairs.forEach((pair) => pair.issues.filter((issue) => issue.severity === "error").forEach((issue) => reportError(`Overlap between photos ${pair.from_index + 1} and ${pair.to_index + 1}`, Object.assign(new Error(issue.message), { code: issue.code }), { detail: `${selected[pair.from_index]?.name} ↔ ${selected[pair.to_index]?.name}\nMatches: ${pair.good_matches}; inliers: ${pair.inliers}; inlier ratio: ${pair.inlier_ratio}` })));
      data.analysis.issues.filter((issue) => issue.severity === "error").forEach((issue) => reportError("Capture set overlap", Object.assign(new Error(issue.message), { code: issue.code }), { photoCount: selected.length }));
      setPairValidations(data.analysis.pairs.map((pair: { from_index: number; to_index: number; good_matches: number; inliers: number; inlier_ratio: number; issues: QualityIssue[] }) => ({ fromIndex: pair.from_index, toIndex: pair.to_index, goodMatches: pair.good_matches, inliers: pair.inliers, inlierRatio: pair.inlier_ratio, issues: pair.issues })));
      setAnalysisIssues(data.analysis.issues);
      setPreflightPassed(data.analysis.can_stitch);
      addDevLog("info", `Panorama image check completed. Can stitch: ${data.analysis.can_stitch}.`);
      return { sources, passed: data.analysis.can_stitch && !checked.some((item) => item.issues.some((issue) => issue.severity === "error")) && !data.analysis.pairs.some((pair) => pair.issues.some((issue) => issue.severity === "error")) && !data.analysis.issues.some((issue) => issue.severity === "error"), revision };
    } catch (validationError) {
      if (revision === workflowRevisionRef.current) {
        reportError(validationStep, validationError, { photoCount: selected.length, algorithm: selectedAlgorithm, ransacThreshold: selectedRansacThreshold, endpoint: validationStep === "photo upload" ? CLOUDINARY_UPLOAD_URL : validationStep === "panorama image check" ? `${PANORAMA_API_URL}/validate/remote` : undefined });
        const detail = validationError instanceof Error ? validationError.message : "The request failed.";
        const networkFailure = /^(load failed|failed to fetch|network ?error|network request failed)$/i.test(detail);
        setError(`${validationStep === "photo upload" ? "Photo upload" : validationStep === "panorama image check" ? "Panorama image check" : "Account check"} failed: ${networkFailure ? "The network request did not complete. Check your connection and try again." : detail}`);
        setValidationFailed(true);
      }
    } finally {
      if (revision === workflowRevisionRef.current) setValidating(false);
    }
  };

  const selectFiles = async (
    selected: File[],
    selectedAlgorithm: "orb" | "sift" = algorithm,
    selectedRansacThreshold: number = ransacThreshold,
    deferRemoteValidation = false,
  ) => {
    addDevLog("info", `Capture set updated: ${selected.length} image${selected.length === 1 ? "" : "s"}.`);
    const revision = workflowRevisionRef.current + 1;
    workflowRevisionRef.current = revision;
    thresholdValidationPendingRef.current = false;
    filesRef.current = selected;
    const selectedSet = new Set(selected);
    for (const file of inspectionCacheRef.current.keys()) if (!selectedSet.has(file)) inspectionCacheRef.current.delete(file);
    for (const file of uploadCacheRef.current.keys()) if (!selectedSet.has(file)) uploadCacheRef.current.delete(file);
    setError("");
    setValidationFailed(false);
    setRestoredInput(null);
    setPanorama("");
    setAiMaskUrl("");
    setMetrics(null);
    setPublished(false);
    tourJob.clear();
    setPreflightPassed(false);
    setPairValidations([]);
    setAnalysisIssues([]);
    setFiles(selected);
    setUploadedSources([]);
    if (deferRemoteValidation) {
      const localResults = await Promise.all(selected.map((file) => cachedPromise(inspectionCacheRef.current, file, () => inspectImage(file))));
      if (revision === workflowRevisionRef.current) {
        setValidations(localResults);
        setValidating(false);
      }
      return;
    }
    return validateFiles(selected, selectedAlgorithm, selectedRansacThreshold, revision);
  };

  const changeRansacThreshold = (value: string) => {
    const next = Math.min(10, Math.max(1, Number(value) || 4));
    if (next === ransacThreshold) return;
    setRansacThreshold(next);
    workflowRevisionRef.current += 1;
    thresholdValidationPendingRef.current = true;
    setPreflightPassed(false);
    setPairValidations([]);
    setAnalysisIssues([]);
    setValidating(false);
    setRestoredInput(null);
    setPanorama("");
    setAiMaskUrl("");
    setMetrics(null);
    setPublished(false);
    tourJob.clear();
    setError("");
  };

  const addCapture = async (file?: File, deferRemoteValidation = false) => {
    if (!file) return false;
    const inspected = await cachedPromise(inspectionCacheRef.current, file, () => inspectImage(file));
    const blockingIssue = inspected.issues.find((issue) => issue.severity === "error");
    if (blockingIssue) {
      reportError("Photo inspection", Object.assign(new Error(blockingIssue.message), { code: blockingIssue.code }), { file, photoIndex: filesRef.current.length, dimensions: `${inspected.width}×${inspected.height}` });
      setError(blockingIssue.message);
      throw new Error(blockingIssue.message);
    }
    updateCaptureView(file, captureView);
    if (deferRemoteValidation) captureSessionDirtyRef.current = true;
    await selectFiles([...filesRef.current, file], algorithm, ransacThreshold, deferRemoteValidation);
    return true;
  };

  const closeCaptureSession = () => {
    setCameraOpen(false);
    if (captureSessionDirtyRef.current) {
      captureSessionDirtyRef.current = false;
      void selectFiles(filesRef.current);
    }
  };

  const removeFile = (index: number) => {
    const removed = filesRef.current[index];
    if (removed === previewedFile) setPreviewedFile(null);
    const nextViews = new Map(captureViewsRef.current);
    nextViews.delete(removed);
    captureViewsRef.current = nextViews;
    setCaptureViews(nextViews);
    void selectFiles(filesRef.current.filter((_, fileIndex) => fileIndex !== index));
  };

  const runReconstruction = async (sources: UploadedSource[], selected: File[], revision: number) => {
    if (generatingRef.current || generating || revision !== workflowRevisionRef.current) return;
    generatingRef.current = true;
    setError("");
    setPublished(false);
    addDevLog("info", `Submitting background tour job with ${selected.length} photos.`);
    try {
      await tourJob.start({ image_urls: sources.map((source) => source.url), algorithm,
        ransac_threshold: ransacThreshold, capture_views: selected.map((file) => captureViewsRef.current.get(file) ?? "around"),
        property_id: selectedProperty, room_type: roomType.trim() });
    } finally { generatingRef.current = false; }
  };
  const generatePanorama = async () => {
    if (!readyToGenerate || !sourcesMatchFiles || generatingRef.current) {
      setError("Complete the room details and resolve critical image or overlap problems before generating the tour.");
      return;
    }
    await runReconstruction(uploadedSources, filesRef.current, workflowRevisionRef.current);
  };

  const finishCaptureAndGenerate = async () => {
    setCameraOpen(false);
    captureSessionDirtyRef.current = false;
    const selected = filesRef.current;
    if (!selectedProperty || !roomType.trim() || selected.length < MIN_CAPTURE_IMAGES) {
      setError("Choose a property and room, then capture at least 6 overlapping photos before generating.");
      return;
    }
    const preflight = await validateFiles(selected, algorithm, ransacThreshold, workflowRevisionRef.current, false);
    if (preflight?.passed) await runReconstruction(preflight.sources, selected, preflight.revision);
  };

  const publishRoomTour = async () => {
    if (!panorama || !selectedProperty || !roomType.trim() || !brokerId || publishingRef.current) return;
    if (!restoredInput && !sourcesMatchFiles) {
      setError("The source-image set changed. Validate the current captures before publishing.");
      return;
    }
    const revision = workflowRevisionRef.current;
    let publishStep = "Find existing room tour";
    addDevLog("info", `Publishing room tour for property ${selectedProperty}, room “${roomType.trim()}”.`);
    publishingRef.current = true;
    setPublishing(true);
    setError("");
    try {
      const existingSnapshot = await getDocs(query(collection(db, "roomTours"), where("propertyId", "==", selectedProperty)));
      const existing = existingSnapshot.docs.find((item) => {
        const data = item.data();
        return data.brokerId === brokerId && String(data.roomType ?? "").trim().toLowerCase() === roomType.trim().toLowerCase();
      });
      const safeRoomName = roomType.trim().replace(/\s+/g, "-").toLowerCase();
      publishStep = "Persist panorama and mask images";
      const [panoramaUrl, persistedSourceUrls, aiGeneratedMaskUrl] = await Promise.all([
        isRemoteImageUrl(panorama) ? Promise.resolve(panorama) : fetch(panorama).then(async (response) => {
          if (!response.ok) throw new HttpResponseError("The generated panorama could not be retrieved.", response);
          return uploadImageToCloudinary(new File([await response.blob()], `${safeRoomName}-360.jpg`, { type: "image/jpeg" }));
        }),
        Promise.resolve(sourceImageUrls),
        isRemoteImageUrl(aiMaskUrl) ? Promise.resolve(aiMaskUrl) : aiMaskUrl ? fetch(aiMaskUrl).then(async (maskResponse) => {
          if (!maskResponse.ok) throw new HttpResponseError("The AI disclosure mask could not be retrieved.", maskResponse);
          return uploadImageToCloudinary(new File([await maskResponse.blob()], `${safeRoomName}-ai-mask.png`, { type: "image/png" }));
        }) : Promise.resolve(""),
      ]);
      const tourData = {
        propertyId: selectedProperty,
        brokerId,
        roomType: roomType.trim(),
        panoramaUrl,
        projection: metrics?.projection ?? "stitched-panorama",
        algorithm: algorithm.toUpperCase(),
        metrics,
        sourceImageCount: sourceImageUrls.length,
        usedSourceImageCount: metrics?.image_count ?? sourceImageUrls.length,
        excludedSourceImageIndices: metrics?.excluded_image_indices ?? [],
        sourceImageUrls: persistedSourceUrls,
        sourceImages: persistedSourceUrls.map((url, index) => ({
          angle: `image-${index + 1}`,
          label: `Image ${index + 1}`,
          view: sourceCaptureViews[index],
          order: index + 1,
          url,
        })),
        roomName: roomType.trim(),
        captureMode: "guided_hybrid",
        captureMethod: "guided-spherical-around-top-bottom",
        captureViews: sourceCaptureViews,
        captureOrder: sourceImageUrls.map((_, index) => `image-${index + 1}`),
        overlapTarget: "30-50%",
        orientation: "landscape",
        ransacThreshold,
        status: "published",
        reconstructionStatus: "completed",
        reconstructionConfidence: metrics?.reconstruction_confidence ?? 0,
        overlapReport: metrics?.overlap_report ?? [],
        ransacReport: metrics?.ransac_report ?? [],
        aiCompletionUsed: metrics?.ai_completion_used ?? false,
        aiGeneratedRegions: metrics?.ai_generated_regions ?? [],
        aiGeneratedMaskUrl,
        disclosureMessage: metrics?.disclosure_message ?? "No AI-assisted completion was used.",
        updatedAt: serverTimestamp(),
      };
      if (revision !== workflowRevisionRef.current) {
        throw new Error("The capture set changed before publishing. Review the current tour and try again.");
      }
      publishStep = "Save room tour in Firestore";
      if (existing) {
        await updateDoc(doc(db, "roomTours", existing.id), tourData);
      } else {
        await addDoc(collection(db, "roomTours"), { ...tourData, createdAt: serverTimestamp() });
      }
      setPublished(true);
      tourJob.clear();
      addDevLog("info", "Room tour published successfully.");
    } catch (publishError) {
      console.error("Unable to publish room tour:", publishError);
      reportError(`Room tour publishing (${publishStep})`, publishError, { endpoint: publishStep === "Persist panorama and mask images" ? CLOUDINARY_UPLOAD_URL : "Firestore: roomTours", method: publishStep === "Persist panorama and mask images" ? "POST" : publishStep === "Find existing room tour" ? "READ" : "WRITE", photoCount: files.length, detail: `Property: ${selectedProperty}\nRoom: ${roomType.trim()}` });
      setError(publishError instanceof Error ? publishError.message : "The tour could not be published.");
    } finally {
      publishingRef.current = false;
      setPublishing(false);
    }
  };

  const reset = () => {
    setRestoredInput(null);
    workflowRevisionRef.current += 1;
    thresholdValidationPendingRef.current = false;
    filesRef.current = [];
    setPreviewedFile(null);
    uploadCacheRef.current.clear();
    inspectionCacheRef.current.clear();
    captureSessionDirtyRef.current = false;
    captureViewsRef.current = new Map();
    setCaptureViews(new Map()); setCaptureView("around");
    setFiles([]); setUploadedSources([]); setValidations([]); setPairValidations([]); setAnalysisIssues([]); setPreflightPassed(false); setPanorama(""); setAiMaskUrl(""); setMetrics(null); setPublished(false); setError(""); setRoomType(""); setValidating(false); tourJob.clear();
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-5 lg:px-8">
          <div className="flex items-center gap-4">
            <Link href="/broker" aria-label="Back to broker dashboard" className="rounded-xl border border-slate-200 p-2.5 text-slate-600 transition hover:bg-slate-50"><ArrowLeft size={19} /></Link>
            <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">LiBot reconstruction studio</p><h1 className="mt-1 text-2xl font-semibold">Guided panorama capture</h1></div>
          </div>
          <Link href="/broker/upload-images" className="hidden rounded-full bg-blue-50 px-4 py-2 text-xs font-semibold text-blue-700 sm:block">Open property gallery upload</Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-7 lg:px-8 lg:py-10">
        <ol className="mb-8 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {stages.map((stage, index) => {
            const complete = index < currentIndex || published;
            const active = index === currentIndex && !published;
            return <li key={stage.id} className={`flex items-center gap-2 rounded-xl border px-3 py-3 text-xs font-semibold ${active ? "border-blue-200 bg-blue-50 text-blue-700" : complete ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-400"}`}>{complete ? <CheckCircle2 size={17} /> : active ? <Circle size={17} fill="currentColor" /> : <Circle size={17} />}<span>{index + 1}. {stage.label}</span></li>;
          })}
        </ol>

        {error && <div role="alert" className="mb-6 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertCircle className="mt-0.5 shrink-0" size={19} /><div><p className="font-semibold">Action needed</p><p className="mt-1">{error}</p>{validationFailed && files.length >= 2 && !validating && <button type="button" onClick={() => void selectFiles(filesRef.current)} className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100">Retry photo upload and check</button>}</div></div>}
        {tourJob.saved && <div className="mb-6 space-y-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          <div role="status" className="flex items-start gap-3">{generating && <LoaderCircle className="shrink-0 animate-spin" size={19} />}<div><p className="font-semibold">{generating ? generationStage : tourJob.job?.status === "completed" ? "Saved tour ready to review" : "Saved capture job"}</p><p className="mt-1">Your photos and generation job are saved. If the connection drops or you leave this page, return here with the same broker account and device to resume.</p><p className="mt-2 break-all font-mono text-xs">Job: {tourJob.saved.id}{tourJob.job ? ` · Processing time: ${(tourJob.job.elapsedMs / 1000).toFixed(1)}s` : ""}</p></div></div>
          {tourJob.error && <p role="alert" className="text-red-800">{tourJob.error}</p>}
          {!generating && !publishing && tourJob.job?.status === "completed" && <button type="button" onClick={() => { setPanorama(""); setAiMaskUrl(""); setMetrics(null); setPublished(false); void tourJob.retry(); }} className="rounded-lg border bg-white px-3 py-2 font-semibold">Regenerate saved photos</button>}
          {!generating && tourJob.job?.status !== "completed" && <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void tourJob.resume()} className="rounded-lg border bg-white px-3 py-2 font-semibold">Check saved job</button>{tourJob.job?.status === "failed" && <button type="button" onClick={() => void tourJob.retry()} className="rounded-lg bg-blue-700 px-3 py-2 font-semibold text-white">Retry saved photos</button>}</div>}
        </div>}
        {published && <div className="mb-6 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-800"><CheckCircle2 className="mt-0.5 shrink-0" /><div><p className="font-semibold">Virtual tour published</p><p className="mt-1 text-sm">Buyers can now explore this room from the property details page.</p></div></div>}

        <div className="grid gap-7">
          <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-6 sm:p-8"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Step 1</p><h2 className="mt-2 text-xl font-semibold">Choose the property and room</h2><p className="mt-2 text-sm leading-6 text-slate-500">Each panorama is published as one room inside a property tour.</p></div>
            <div className="grid gap-5 p-6 sm:grid-cols-2 sm:p-8">
              <label className="text-sm font-semibold text-slate-700">Property<select value={selectedProperty} onChange={(event) => { setSelectedProperty(event.target.value); setPublished(false); }} disabled={propertiesLoading || generating || publishing} className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-white px-4 font-normal outline-none focus:border-blue-400"><option value="">{propertiesLoading ? "Loading properties…" : "Select a property"}</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.title || "Untitled property"}</option>)}</select></label>
              <label className="text-sm font-semibold text-slate-700">Room or area<input value={roomType} disabled={generating || publishing} onChange={(event) => { setRoomType(event.target.value); setPublished(false); }} placeholder="e.g. Living room" className="mt-2 h-12 w-full rounded-xl border border-slate-200 px-4 font-normal outline-none placeholder:text-slate-400 focus:border-blue-400" /></label>
              {roomType.trim() && <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm sm:col-span-2"><div><span className="font-semibold text-slate-900">{roomType.trim()}</span><span className="ml-3 text-slate-600">{publishing ? "Publishing" : published ? "Published" : generating ? "Stitching" : validating && /upload/i.test(validationStage) ? "Uploading" : validating ? "Checking photos" : panorama ? "Ready to preview" : error && files.length ? "Needs attention" : files.length ? "Photos added" : "Waiting for photos"}</span>{error && files.length > 0 && <p className="mt-1 text-xs text-red-700">This room needs attention: {error}</p>}</div>{error && files.length > 0 && !generating && !validating && <button type="button" onClick={() => void (validationFailed ? selectFiles(filesRef.current) : readyToGenerate ? generatePanorama() : selectFiles(filesRef.current))} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100">Retry this room</button>}</div>}
            </div>

            <div className="border-y border-slate-200 bg-slate-50/60 p-6 sm:p-8">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Step 2</p>
              <h2 className="mt-2 text-xl font-semibold">Capture around, top, and bottom</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">Start with a full circle of level views, then add overlapping ceiling and floor views. Use at least 6 landscape photos. There is no fixed photo-count limit; larger sets take longer and remain subject to processing-size limits. In live capture, take consecutive photos and switch between walls, ceiling, and floor without closing the camera. Tap Finish &amp; generate to create the tour, or Done to review and check the photos first.</p>
              <div className="mt-5 grid gap-2 sm:grid-cols-3" role="group" aria-label="Next photo type">
                {CAPTURE_VIEWS.map((view) => <button key={view} type="button" aria-pressed={captureView === view} disabled={validating || generating || publishing} onClick={() => setCaptureView(view)} className={`rounded-xl border p-3 text-left disabled:opacity-50 ${captureView === view ? "border-blue-300 bg-blue-50 ring-2 ring-blue-100" : "border-slate-200 bg-white"}`}><p className="text-sm font-semibold">{CAPTURE_GUIDE[view].label}</p><p className="mt-1 text-xs text-slate-500">{sourceCaptureViews.filter((item) => item === view).length} photos added</p></button>)}
              </div>
              <p className="mt-3 text-xs leading-5 text-amber-800">Adding a top or bottom photo does not guarantee full coverage. Include shared wall/roof details, bridge large tilt changes, and capture directly overhead and below. Blank ceilings or sky may not have enough features to align.</p>
              <div className="mt-5 rounded-2xl border border-blue-200 bg-white p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-600">Capture {files.length + 1} · {CAPTURE_GUIDE[captureView].label}</p>
                <h3 className="mt-2 text-lg font-semibold">{CAPTURE_GUIDE[captureView].title}</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">{CAPTURE_GUIDE[captureView].direction}</p>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <button type="button" disabled={validating || generating || publishing} onClick={() => setCameraOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"><Camera size={18} />Open phone camera</button>
                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700"><input type="file" accept="image/jpeg,image/png,image/webp" disabled={validating || generating || publishing} className="sr-only" onChange={(event) => { void addCapture(event.target.files?.[0]).catch(() => {}); event.currentTarget.value = ""; }} /><UploadCloud size={18} />Choose existing photo</label>
                </div>
                <p className="mt-2 text-center text-xs text-slate-400">Landscape JPG, PNG, or WEBP · recommended 1280×720 or larger</p>
              </div>
              {validating && <p role="status" className="mt-4 flex items-center gap-2 text-sm text-blue-700"><LoaderCircle className="animate-spin" size={17} />{validationStage || "Checking photos…"}</p>}
              {validations.length > 0 && <div className="mt-5 space-y-2">{validations.map((item, index) => {
                const hasError = item.issues.some((issue) => issue.severity === "error");
                const firstIssue = item.issues.find((issue) => issue.severity === "error") ?? item.issues[0];
                return <div key={`${item.file.name}-${index}`} className={`flex items-center gap-3 rounded-xl border bg-white p-3 ${hasError ? "border-red-200" : firstIssue ? "border-amber-200" : "border-slate-200"}`}><button type="button" onClick={() => setPreviewedFile(item.file)} aria-label={`Preview photo ${index + 1}: ${item.file.name}`} className="group relative size-14 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-500"><LocalCaptureImage file={item.file} alt={`Photo ${index + 1} thumbnail`} className="size-full object-cover" /><span className="absolute bottom-0 right-0 rounded-tl-md bg-slate-950/75 p-1 text-white"><Eye size={13} /></span></button><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{index + 1}. {CAPTURE_GUIDE[captureViews.get(item.file) ?? "around"].label} · {item.file.name}</p><p className={`mt-0.5 text-xs ${hasError ? "text-red-700" : firstIssue ? "text-amber-700" : "text-slate-400"}`}>{firstIssue?.message || `${item.width}×${item.height} · ${item.keypoints == null ? "Overlap check pending" : `${item.keypoints} features · Checked`}`}</p>{item.blurScore !== undefined && <p className="mt-1 text-[10px] text-slate-400">Sharpness {item.blurScore.toFixed(0)} · Brightness {item.brightness?.toFixed(0)} · {item.keypoints} keypoints</p>}</div><select aria-label={`Photo type for image ${index + 1}`} value={captureViews.get(item.file) ?? "around"} disabled={validating || generating || publishing} onChange={(event) => { const next = event.target.value as CaptureView; updateCaptureView(item.file, next); void selectFiles(filesRef.current); }} className="max-w-28 rounded-lg border border-slate-200 p-2 text-xs">{CAPTURE_VIEWS.map((view) => <option key={view} value={view}>{CAPTURE_GUIDE[view].label}</option>)}</select><button type="button" disabled={generating || publishing} onClick={() => removeFile(index)} aria-label={`Remove image ${index + 1}: ${item.file.name}`} title="Remove only this photo" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-red-600"><Trash2 size={17} /></button></div>;
              })}</div>}
              {analysisIssues.length > 0 && <div className="mt-5 space-y-2">{analysisIssues.map((issue) => <div key={issue.code} role={issue.severity === "error" ? "alert" : "status"} className={`rounded-xl border p-3 text-sm ${issue.severity === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}><p className="font-semibold">Image set overlap</p><p className="mt-1">{issue.message}</p></div>)}</div>}
              {pairValidations.length > 0 && <div className="mt-5"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Matched image overlap</p><p className="mb-3 mt-1 text-xs leading-5 text-slate-500">These links connect matching views across the full image set. Every image must connect to the others, even when uploaded out of order.</p><div className="grid gap-2 sm:grid-cols-2">{pairValidations.map((pair) => {
                const issue = pair.issues[0];
                const hasError = pair.issues.some((item) => item.severity === "error");
                return <div key={`${pair.fromIndex}-${pair.toIndex}`} className={`rounded-xl border p-3 ${hasError ? "border-red-200 bg-red-50" : issue ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}><div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold">{`Image ${pair.fromIndex + 1}`} ↔ {`Image ${pair.toIndex + 1}`}</p><span className={`text-[10px] font-semibold ${hasError ? "text-red-700" : issue ? "text-amber-700" : "text-emerald-700"}`}>{hasError ? "RETAKE" : issue ? "WEAK" : "GOOD"}</span></div><p className="mt-1 break-words text-[11px] text-slate-500">{files[pair.fromIndex]?.name} ↔ {files[pair.toIndex]?.name}</p><p className="mt-1 text-[11px] text-slate-600">{issue?.message || `${pair.goodMatches} matches · ${(pair.inlierRatio * 100).toFixed(0)}% inliers`}</p></div>;
              })}</div></div>}
            </div>

            <div className="p-6 sm:p-8"><div className="flex flex-col gap-4 sm:flex-row sm:items-end"><div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800"><p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Feature detector</p><p className="mt-1 font-semibold">SIFT — stronger matching</p></div><label className="text-sm font-semibold text-slate-700">RANSAC threshold<input type="number" min="1" max="10" step="0.5" value={ransacThreshold} disabled={generating || publishing} onChange={(event) => changeRansacThreshold(event.target.value)} onBlur={() => { if (thresholdValidationPendingRef.current && filesRef.current.length) void selectFiles(filesRef.current, algorithm, ransacThreshold); }} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal outline-none sm:w-40" /></label><button type="button" onClick={() => void generatePanorama()} disabled={!readyToGenerate || generating} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40 sm:ml-auto">{generating ? <LoaderCircle className="animate-spin" size={18} /> : <Images size={18} />}{generating ? "Reconstructing room…" : "Generate virtual tour"}</button></div>{files.length > 0 && <p className={`mt-4 text-xs ${readyToGenerate ? "text-emerald-700" : "text-slate-500"}`}>{readyToGenerate ? `${files.length} photos ready to generate.` : blockingIssues > 0 ? `Review ${blockingIssues} photo issue${blockingIssues === 1 ? "" : "s"} before generating.` : files.length < MIN_CAPTURE_IMAGES ? `${files.length} of ${MIN_CAPTURE_IMAGES} photos added.` : validating ? "Checking photos…" : "Complete photo checks to generate."}</p>}</div>
          </section>

        </div>

        <section id="generated-tour-preview" className="mt-8 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Step 3</p><h2 className="mt-2 text-xl font-semibold">Review the reconstructed room</h2></div>{quality && <span className={`w-fit rounded-full px-3 py-1.5 text-xs font-semibold ${quality.style}`}>{quality.label}</span>}</div>
          {metrics?.coverage_report && <CaptureCoverage report={metrics.coverage_report} />}
          <div className="p-4 sm:p-8">{panorama ? <><PanoramaViewer panorama={panorama} caption={`${roomType.trim()} virtual tour`} />{metrics && <><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4"><Metric label="Confidence" value={`${((metrics.reconstruction_confidence ?? 0) * 100).toFixed(1)}%`} /><Metric label="Evidence coverage" value={`${((metrics.evidence_coverage_ratio ?? 0) * 100).toFixed(1)}%`} /><Metric label="Mean inliers" value={`${((metrics.average_inlier_ratio ?? 0) * 100).toFixed(1)}%`} /><Metric label="AI-filled area" value={`${((metrics.ai_filled_ratio ?? 0) * 100).toFixed(1)}%`} /></div><div className={`mt-4 flex gap-3 rounded-2xl border p-4 text-sm ${metrics.ai_completion_used ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}><Info className="mt-0.5 shrink-0" size={19} /><div><p className="font-semibold">Reconstruction disclosure</p><p className="mt-1 leading-6">{metrics.disclosure_message}</p>{metrics.ai_completion_used && <a href={aiMaskUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex font-semibold underline">View generated-region mask</a>}</div></div></>}<div className="mt-6 flex flex-col gap-3 border-t border-slate-200 pt-6 sm:flex-row sm:justify-between"><button onClick={() => { tourJob.clear(); setRestoredInput(null); setPanorama(""); setAiMaskUrl(""); setMetrics(null); setPublished(false); }} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"><RotateCcw size={17} />Recapture or regenerate</button><button onClick={() => void publishRoomTour()} disabled={publishing || published} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">{publishing ? <LoaderCircle className="animate-spin" size={18} /> : published ? <CheckCircle2 size={18} /> : <Eye size={18} />}{publishing ? "Publishing…" : published ? "Published" : "Publish room tour"}</button></div></> : <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 text-center"><span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm"><ImageIcon size={27} /></span><p className="mt-4 font-semibold">Your immersive preview will appear here</p><p className="mt-2 max-w-md text-sm leading-6 text-slate-500">Complete the room details, add overlapping images, and generate the tour.</p></div>}</div>
        </section>

        {published && <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-end"><Link href="/broker/properties" className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">Manage properties<ChevronRight size={17} /></Link><button onClick={reset} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white">Create another room tour<ChevronRight size={17} /></button></div>}
      </main>
      {debugLogsEnabled && <section aria-label="Development logs" className={`fixed bottom-4 right-4 z-[70] flex w-[min(42rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 text-slate-100 shadow-2xl ${devLogsOpen ? "aspect-[4/3]" : ""}`}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
          <button type="button" onClick={() => setDevLogsOpen((open) => !open)} className="flex min-w-0 items-center gap-2 text-left text-sm font-semibold"><Bug size={16} className="shrink-0 text-amber-300" /><span>Development logs</span><span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">{devLogs.length}</span></button>
          <div className="flex items-center gap-3"><button type="button" onClick={() => setDevLogs([])} className="text-xs text-slate-400 hover:text-white">Clear</button><button type="button" onClick={() => setDevLogsOpen((open) => !open)} aria-label={devLogsOpen ? "Collapse development logs" : "Expand development logs"} className="text-xs font-semibold text-blue-300">{devLogsOpen ? "Hide" : "Show"}</button></div>
        </div>
        {devLogsOpen && <div ref={logListRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3" aria-live="polite">
          {devLogs.length === 0 ? <p className="px-1 py-3 text-xs text-slate-400">Live camera, upload, validation, generation, and publish events will appear here.</p> : devLogs.map((entry) => <article key={entry.id} className={`rounded-lg border px-3 py-2 ${entry.level === "error" ? "border-red-900/80 bg-red-950/50" : "border-slate-800 bg-slate-900"}`}><p className={`text-xs font-semibold ${entry.level === "error" ? "text-red-300" : "text-slate-200"}`}><time className="mr-2 font-normal text-slate-500">{entry.time}</time>{entry.message}</p>{entry.detail && <details open={entry.level === "error"} className="mt-2"><summary className="cursor-pointer text-[11px] text-slate-400">Diagnostic details</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-slate-300">{entry.detail}</pre></details>}</article>)}
        </div>}
      </section>}
      {previewedFile && previewIndex >= 0 && <CapturedPhotoPreview file={previewedFile} index={previewIndex} total={files.length} view={captureViews.get(previewedFile) ?? "around"} dimensions={previewValidation} issues={previewValidation?.issues.map((issue) => issue.message)} onPrevious={previewIndex > 0 ? () => setPreviewedFile(files[previewIndex - 1]) : undefined} onNext={previewIndex < files.length - 1 ? () => setPreviewedFile(files[previewIndex + 1]) : undefined} onClose={() => setPreviewedFile(null)} onImageError={() => reportError("Photo preview", new Error("The saved image could not be displayed."), { file: previewedFile, photoIndex: previewIndex })} />}
      {cameraOpen && <PhoneCameraCapture captureView={captureView} onCaptureViewChange={setCaptureView} imageNumber={files.length + 1} onFinish={selectedProperty && roomType.trim() && files.length >= MIN_CAPTURE_IMAGES ? () => void finishCaptureAndGenerate() : undefined} onCapture={async (file) => { addDevLog("info", `Live camera captured ${file.name} (${file.type || "unknown type"}, ${Math.round(file.size / 1024)} KB).`); return addCapture(file, true); }} onDebug={(message, detail) => reportError("Live camera", new Error(`${message}${detail ? ` ${detail.split("\n")[0]}` : ""}`), { photoIndex: files.length, detail })} onClose={closeCaptureSession} />}
    </div>
  );
}

function CaptureCoverage({ report }: { report: NonNullable<HybridMetadata["coverage_report"]> }) {
  return <div className="mx-4 mt-5 rounded-2xl border border-blue-100 bg-blue-50 p-4 sm:mx-8">
    <h3 className="text-sm font-semibold">Real-photo coverage</h3>
    <div className="mt-3 grid grid-cols-3 gap-2"><Metric label="Around" value={`${(report.around_coverage_ratio * 100).toFixed(1)}%`} /><Metric label="Top / ceiling" value={`${(report.top_coverage_ratio * 100).toFixed(1)}%`} /><Metric label="Bottom / floor" value={`${(report.bottom_coverage_ratio * 100).toFixed(1)}%`} /></div>
    <p className="mt-3 text-xs leading-5 text-slate-700">Top and bottom measure the 30° areas nearest overhead and below. These percentages measure captured pixels, not alignment quality.</p>
    {report.missing_ratio > 0 && <p role="status" className="mt-2 text-sm text-amber-900">{(report.missing_ratio * 100).toFixed(2)}% of the panorama has no photo evidence. Review the preview and add overlapping views of the missing areas before publishing. Labels alone do not fill gaps.</p>}
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-slate-50 p-4"><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p><p className="mt-1 text-sm font-semibold text-slate-800">{value}</p></div>; }
