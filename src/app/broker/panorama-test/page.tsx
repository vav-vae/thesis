"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged } from "firebase/auth";
import { addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import {
  AlertCircle,
  ArrowLeft,
  Camera,
  Check,
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
import { auth, db } from "@/lib/firebase";
import { readJsonResponse } from "@/lib/http-response";
import { CAPTURE_GUIDE, CAPTURE_VIEWS, MAX_CAPTURE_IMAGES, MIN_CAPTURE_IMAGES, type CaptureView } from "@/lib/capture-guide";
import {
  isRemoteImageUrl,
  uploadImageToCloudinary,
  uploadPanoramaSourceToCloudinary,
} from "@/lib/cloudinary";
import {
  panoramaApiError,
  panoramaApiFetch,
  reconstructHybridPanorama,
  type HybridMetadata,
} from "@/lib/panorama-api";

type StitchMetrics = Partial<HybridMetadata> & { output_width: number; output_height: number; processing_ms?: number; coverage_ratio?: number };

type PropertyOption = { id: string; title?: string };
type QualityIssue = { severity: "warning" | "error"; code: string; message: string };
type Validation = { file: File; width: number; height: number; blurScore?: number; brightness?: number; keypoints?: number; issues: QualityIssue[] };
type PairValidation = { fromIndex: number; toIndex: number; goodMatches: number; inliers: number; inlierRatio: number; issues: QualityIssue[] };
type UploadedSource = { file: File; url: string };
type Stage = "details" | "images" | "preview" | "publish";

const CAPTURE_STEPS = [
  ...Array.from({ length: MAX_CAPTURE_IMAGES }, (_, index) => ({
    id: `image-${index + 1}`,
    label: `Image ${index + 1}`,
    direction: index === 0
      ? "Choose any starting view and keep the camera in one fixed position."
      : "Rotate slowly in the same direction while retaining 30–50% of the previous view.",
  })),
] as const;

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
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [error, setError] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [lastCaptureHeading, setLastCaptureHeading] = useState<number | null>(null);
  const filesRef = useRef<File[]>([]);
  const workflowRevisionRef = useRef(0);
  const thresholdValidationPendingRef = useRef(false);
  const generatingRef = useRef(false);
  const publishingRef = useRef(false);

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
      setError("Your properties could not be loaded. Check your connection and permissions.");
    } finally {
      setPropertiesLoading(false);
    }
  }), []);

  const currentStage: Stage = published ? "publish" : panorama ? "preview" : files.length ? "images" : "details";
  const currentIndex = stages.findIndex((stage) => stage.id === currentStage);
  const allIssues = [...validations.flatMap((item) => item.issues), ...pairValidations.flatMap((pair) => pair.issues), ...analysisIssues];
  const blockingIssues = allIssues.filter((issue) => issue.severity === "error").length;
  const warningIssues = allIssues.filter((issue) => issue.severity === "warning").length;
  const sourcesMatchFiles = uploadedSources.length === files.length
    && uploadedSources.every((source, index) => source.file === files[index]);
  const sourceImageUrls = uploadedSources.map((source) => source.url);
  const sourceCaptureViews = files.map((file) => captureViews.get(file) ?? "around");
  const readyToGenerate = Boolean(selectedProperty && roomType.trim() && files.length >= MIN_CAPTURE_IMAGES && files.length <= MAX_CAPTURE_IMAGES && sourcesMatchFiles && preflightPassed && !validating && !blockingIssues);
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
  ) => {
    setValidating(true);
    const localResults = await Promise.all(selected.map(inspectImage));
    if (revision !== workflowRevisionRef.current) return;
    setValidations(localResults);
    setPairValidations([]);
    if (selected.length < 2) {
      setValidating(false);
      return;
    }
    if (localResults.some((result) => result.issues.some((issue) => issue.severity === "error"))) {
      setValidating(false);
      return;
    }
    try {
      await auth.authStateReady();
      const user = auth.currentUser;
      if (!user) throw new Error("Sign in before uploading panorama sources.");
      const sources = await Promise.all(selected.map(async (file) => ({
        file,
        url: await uploadPanoramaSourceToCloudinary(file, user.uid),
      })));
      if (revision !== workflowRevisionRef.current) return;
      setUploadedSources(sources);
      const response = await panoramaApiFetch("/validate/remote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_urls: sources.map((source) => source.url),
          algorithm: selectedAlgorithm,
          ransac_threshold: selectedRansacThreshold,
        }),
      });
      if (!response.ok) throw await panoramaApiError(response, "Computer vision preflight failed.");
      const data = await readJsonResponse<{ success: boolean; detail?: string; analysis: { can_stitch: boolean; issues: QualityIssue[]; images: { width: number; height: number; blur_score: number; brightness: number; keypoints: number; issues: QualityIssue[] }[]; pairs: { from_index: number; to_index: number; good_matches: number; inliers: number; inlier_ratio: number; issues: QualityIssue[] }[] } }>(response, "Computer vision preflight failed.");
      if (!data.success) throw new Error(data.detail || "Computer vision preflight failed.");
      if (revision !== workflowRevisionRef.current) return;
      const matchedImages = new Set(data.analysis.pairs.flatMap((pair) => [pair.from_index, pair.to_index]));
      setValidations(localResults.map((local, index) => {
        const server = data.analysis.images[index];
        const serverCodes = new Set<string>(server.issues.map((issue: QualityIssue) => issue.code));
        const localOnly = local.issues.filter((issue) => !serverCodes.has(issue.code));
        const overlapIssues: QualityIssue[] = matchedImages.has(index) ? [] : [{
          severity: "error",
          code: "image_unconnected",
          message: "No reliable overlap with the other photos. Remove this photo or add a view connecting it to the set.",
        }];
        return { ...local, width: server.width, height: server.height, blurScore: server.blur_score, brightness: server.brightness, keypoints: server.keypoints, issues: [...server.issues, ...overlapIssues, ...localOnly] };
      }));
      setPairValidations(data.analysis.pairs.map((pair: { from_index: number; to_index: number; good_matches: number; inliers: number; inlier_ratio: number; issues: QualityIssue[] }) => ({ fromIndex: pair.from_index, toIndex: pair.to_index, goodMatches: pair.good_matches, inliers: pair.inliers, inlierRatio: pair.inlier_ratio, issues: pair.issues })));
      setAnalysisIssues(data.analysis.issues);
      setPreflightPassed(data.analysis.can_stitch);
    } catch (validationError) {
      if (revision === workflowRevisionRef.current) {
        setError(validationError instanceof Error ? validationError.message : "Could not connect to the panorama processor.");
      }
    } finally {
      if (revision === workflowRevisionRef.current) setValidating(false);
    }
  };

  const selectFiles = async (
    selected: File[],
    selectedAlgorithm: "orb" | "sift" = algorithm,
    selectedRansacThreshold: number = ransacThreshold,
  ) => {
    const revision = workflowRevisionRef.current + 1;
    workflowRevisionRef.current = revision;
    thresholdValidationPendingRef.current = false;
    filesRef.current = selected;
    setError("");
    setPanorama("");
    setAiMaskUrl("");
    setMetrics(null);
    setPublished(false);
    setGenerating(false);
    setPreflightPassed(false);
    setPairValidations([]);
    setAnalysisIssues([]);
    setFiles(selected);
    setUploadedSources([]);
    await validateFiles(selected, selectedAlgorithm, selectedRansacThreshold, revision);
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
    setPanorama("");
    setAiMaskUrl("");
    setMetrics(null);
    setPublished(false);
    setGenerating(false);
    setError("");
  };

  const addCapture = async (file?: File) => {
    if (!file || filesRef.current.length >= MAX_CAPTURE_IMAGES) return false;
    const inspected = await inspectImage(file);
    if (inspected.issues.some((issue) => issue.severity === "error" && issue.code === "client_portrait")) {
      setError(inspected.issues.find((issue) => issue.code === "client_portrait")?.message ?? "Use a landscape image.");
      return false;
    }
    if (filesRef.current.length >= MAX_CAPTURE_IMAGES) return false;
    setCaptureViews((previous) => new Map(previous).set(file, captureView));
    await selectFiles([...filesRef.current, file]);
    return true;
  };

  const removeFile = (index: number) => {
    setLastCaptureHeading(null);
    const removed = filesRef.current[index];
    setCaptureViews((previous) => { const next = new Map(previous); next.delete(removed); return next; });
    void selectFiles(filesRef.current.filter((_, fileIndex) => fileIndex !== index));
  };

  const generatePanorama = async () => {
    if (!readyToGenerate || !sourcesMatchFiles || generatingRef.current) {
      setError("Complete the room details and resolve critical image or overlap problems before generating the tour.");
      return;
    }
    const revision = workflowRevisionRef.current;
    const persistedSourceUrls = uploadedSources.map((source) => source.url);
    generatingRef.current = true;
    setGenerating(true);
    setError("");
    setPublished(false);
    try {
      const result = await reconstructHybridPanorama(persistedSourceUrls, { algorithm, ransacThreshold, fillGaps: true, captureViews: sourceCaptureViews });
      if (revision !== workflowRevisionRef.current) return;
      setPanorama(result.panoramaUrl);
      setAiMaskUrl(result.aiMaskUrl);
      setMetrics(result.metadata);
    } catch (generateError) {
      if (revision === workflowRevisionRef.current) {
        setError(generateError instanceof Error ? generateError.message : "Could not connect to the panorama processor.");
      }
    } finally {
      generatingRef.current = false;
      if (revision === workflowRevisionRef.current) setGenerating(false);
    }
  };

  const publishRoomTour = async () => {
    if (!panorama || !selectedProperty || !roomType.trim() || !brokerId || publishingRef.current) return;
    if (!sourcesMatchFiles) {
      setError("The source-image set changed. Validate the current captures before publishing.");
      return;
    }
    const revision = workflowRevisionRef.current;
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
      const [panoramaUrl, persistedSourceUrls, aiGeneratedMaskUrl] = await Promise.all([
        isRemoteImageUrl(panorama) ? Promise.resolve(panorama) : fetch(panorama).then(async (response) => {
          if (!response.ok) throw new Error("The generated panorama could not be retrieved.");
          return uploadImageToCloudinary(new File([await response.blob()], `${safeRoomName}-360.jpg`, { type: "image/jpeg" }));
        }),
        Promise.resolve(sourceImageUrls),
        isRemoteImageUrl(aiMaskUrl) ? Promise.resolve(aiMaskUrl) : aiMaskUrl ? fetch(aiMaskUrl).then(async (maskResponse) => {
          if (!maskResponse.ok) throw new Error("The AI disclosure mask could not be retrieved.");
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
        sourceImageCount: files.length,
        sourceImageUrls: persistedSourceUrls,
        sourceImages: persistedSourceUrls.map((url, index) => ({
          angle: CAPTURE_STEPS[index].id,
          label: CAPTURE_STEPS[index].label,
          view: sourceCaptureViews[index],
          order: index + 1,
          url,
        })),
        roomName: roomType.trim(),
        captureMode: "guided_hybrid",
        captureMethod: "guided-spherical-around-top-bottom",
        captureViews: sourceCaptureViews,
        captureOrder: CAPTURE_STEPS.slice(0, files.length).map((step) => step.id),
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
      if (existing) {
        await updateDoc(doc(db, "roomTours", existing.id), tourData);
      } else {
        await addDoc(collection(db, "roomTours"), { ...tourData, createdAt: serverTimestamp() });
      }
      setPublished(true);
    } catch (publishError) {
      console.error("Unable to publish room tour:", publishError);
      setError(publishError instanceof Error ? publishError.message : "The tour could not be published.");
    } finally {
      publishingRef.current = false;
      setPublishing(false);
    }
  };

  const reset = () => {
    workflowRevisionRef.current += 1;
    thresholdValidationPendingRef.current = false;
    filesRef.current = [];
    setCaptureViews(new Map()); setCaptureView("around");
    setFiles([]); setUploadedSources([]); setValidations([]); setPairValidations([]); setAnalysisIssues([]); setPreflightPassed(false); setPanorama(""); setAiMaskUrl(""); setMetrics(null); setPublished(false); setError(""); setRoomType(""); setLastCaptureHeading(null); setValidating(false); setGenerating(false);
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

        {error && <div role="alert" className="mb-6 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertCircle className="mt-0.5 shrink-0" size={19} /><div><p className="font-semibold">Action needed</p><p className="mt-1">{error}</p></div></div>}
        {published && <div className="mb-6 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-800"><CheckCircle2 className="mt-0.5 shrink-0" /><div><p className="font-semibold">Virtual tour published</p><p className="mt-1 text-sm">Buyers can now explore this room from the property details page.</p></div></div>}

        <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-6 sm:p-8"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Step 1</p><h2 className="mt-2 text-xl font-semibold">Choose the property and room</h2><p className="mt-2 text-sm leading-6 text-slate-500">Each panorama is published as one room inside a property tour.</p></div>
            <div className="grid gap-5 p-6 sm:grid-cols-2 sm:p-8">
              <label className="text-sm font-semibold text-slate-700">Property<select value={selectedProperty} onChange={(event) => { setSelectedProperty(event.target.value); setPublished(false); }} disabled={propertiesLoading} className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-white px-4 font-normal outline-none focus:border-blue-400"><option value="">{propertiesLoading ? "Loading properties…" : "Select a property"}</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.title || "Untitled property"}</option>)}</select></label>
              <label className="text-sm font-semibold text-slate-700">Room or area<input value={roomType} onChange={(event) => { setRoomType(event.target.value); setPublished(false); }} placeholder="e.g. Living room" className="mt-2 h-12 w-full rounded-xl border border-slate-200 px-4 font-normal outline-none placeholder:text-slate-400 focus:border-blue-400" /></label>
            </div>

            <div className="border-y border-slate-200 bg-slate-50/60 p-6 sm:p-8">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Step 2</p>
              <h2 className="mt-2 text-xl font-semibold">Capture around, top, and bottom</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">Start with a full circle of level views, then add overlapping ceiling and floor views. Use 6–24 landscape photos in total. Select the photo type before uploading or opening the live camera.</p>
              <div className="mt-5 grid gap-2 sm:grid-cols-3" role="group" aria-label="Next photo type">
                {CAPTURE_VIEWS.map((view) => <button key={view} type="button" aria-pressed={captureView === view} disabled={validating || generating || publishing} onClick={() => { setCaptureView(view); setLastCaptureHeading(null); }} className={`rounded-xl border p-3 text-left disabled:opacity-50 ${captureView === view ? "border-blue-300 bg-blue-50 ring-2 ring-blue-100" : "border-slate-200 bg-white"}`}><p className="text-sm font-semibold">{CAPTURE_GUIDE[view].label}</p><p className="mt-1 text-xs text-slate-500">{sourceCaptureViews.filter((item) => item === view).length} photos added</p></button>)}
              </div>
              <p className="mt-3 text-xs leading-5 text-amber-800">Adding a top or bottom photo does not guarantee full coverage. Include shared wall/roof details, bridge large tilt changes, and capture directly overhead and below. Blank ceilings or sky may not have enough features to align.</p>
              {files.length < MAX_CAPTURE_IMAGES ? <div className="mt-5 rounded-2xl border border-blue-200 bg-white p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-600">Capture {files.length + 1} of {MAX_CAPTURE_IMAGES} · {CAPTURE_GUIDE[captureView].label}</p>
                <h3 className="mt-2 text-lg font-semibold">{CAPTURE_GUIDE[captureView].title}</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">{CAPTURE_GUIDE[captureView].direction}</p>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <button type="button" disabled={validating || generating || publishing} onClick={() => setCameraOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"><Camera size={18} />Open phone camera</button>
                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700"><input type="file" accept="image/jpeg,image/png,image/webp" disabled={validating || generating || publishing} className="sr-only" onChange={(event) => { void addCapture(event.target.files?.[0]); event.currentTarget.value = ""; }} /><UploadCloud size={18} />Choose existing photo</label>
                </div>
                <p className="mt-2 text-center text-xs text-slate-400">Landscape JPG, PNG, or WEBP · recommended 1280×720 or larger</p>
              </div> : <p className="mt-5 rounded-xl bg-blue-50 p-4 text-sm text-blue-800">Maximum of {MAX_CAPTURE_IMAGES} photos reached. Review coverage after generation; remove redundant photos if you need more bridging views.</p>}
              {validating && <p className="mt-4 flex items-center gap-2 text-sm text-blue-700"><LoaderCircle className="animate-spin" size={17} />Running blur, exposure, feature, and overlap checks…</p>}
              {validations.length > 0 && <div className="mt-5 space-y-2">{validations.map((item, index) => {
                const hasError = item.issues.some((issue) => issue.severity === "error");
                const firstIssue = item.issues.find((issue) => issue.severity === "error") ?? item.issues[0];
                return <div key={`${item.file.name}-${index}`} className={`flex items-center gap-3 rounded-xl border bg-white p-3 ${hasError ? "border-red-200" : firstIssue ? "border-amber-200" : "border-slate-200"}`}><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${hasError ? "bg-red-50 text-red-600" : firstIssue ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600"}`}>{firstIssue ? <AlertCircle size={18} /> : <Check size={18} />}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{index + 1}. {CAPTURE_GUIDE[captureViews.get(item.file) ?? "around"].label} · {item.file.name}</p><p className={`mt-0.5 text-xs ${hasError ? "text-red-700" : firstIssue ? "text-amber-700" : "text-slate-400"}`}>{firstIssue?.message || `${item.width}×${item.height} · ${item.keypoints ?? "—"} features · Ready`}</p>{item.blurScore !== undefined && <p className="mt-1 text-[10px] text-slate-400">Sharpness {item.blurScore.toFixed(0)} · Brightness {item.brightness?.toFixed(0)} · {item.keypoints} keypoints</p>}</div><select aria-label={`Photo type for image ${index + 1}`} value={captureViews.get(item.file) ?? "around"} disabled={validating || generating || publishing} onChange={(event) => { const next = event.target.value as CaptureView; setCaptureViews((previous) => new Map(previous).set(item.file, next)); void selectFiles(filesRef.current); }} className="max-w-28 rounded-lg border border-slate-200 p-2 text-xs">{CAPTURE_VIEWS.map((view) => <option key={view} value={view}>{CAPTURE_GUIDE[view].label}</option>)}</select><button type="button" disabled={generating || publishing} onClick={() => removeFile(index)} aria-label={`Remove image ${index + 1}: ${item.file.name}`} title="Remove only this photo" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-red-600"><Trash2 size={17} /></button></div>;
              })}</div>}
              {analysisIssues.length > 0 && <div className="mt-5 space-y-2">{analysisIssues.map((issue) => <div key={issue.code} role={issue.severity === "error" ? "alert" : "status"} className={`rounded-xl border p-3 text-sm ${issue.severity === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}><p className="font-semibold">Image set overlap</p><p className="mt-1">{issue.message}</p></div>)}</div>}
              {pairValidations.length > 0 && <div className="mt-5"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Matched image overlap</p><p className="mb-3 mt-1 text-xs leading-5 text-slate-500">These links connect matching views across the full image set. Every image must connect to the others, even when uploaded out of order.</p><div className="grid gap-2 sm:grid-cols-2">{pairValidations.map((pair) => {
                const issue = pair.issues[0];
                const hasError = pair.issues.some((item) => item.severity === "error");
                return <div key={`${pair.fromIndex}-${pair.toIndex}`} className={`rounded-xl border p-3 ${hasError ? "border-red-200 bg-red-50" : issue ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}><div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold">{CAPTURE_STEPS[pair.fromIndex].label} ↔ {CAPTURE_STEPS[pair.toIndex].label}</p><span className={`text-[10px] font-semibold ${hasError ? "text-red-700" : issue ? "text-amber-700" : "text-emerald-700"}`}>{hasError ? "RETAKE" : issue ? "WEAK" : "GOOD"}</span></div><p className="mt-1 break-words text-[11px] text-slate-500">{files[pair.fromIndex]?.name} ↔ {files[pair.toIndex]?.name}</p><p className="mt-1 text-[11px] text-slate-600">{issue?.message || `${pair.goodMatches} matches · ${(pair.inlierRatio * 100).toFixed(0)}% inliers`}</p></div>;
              })}</div></div>}
            </div>

            <div className="p-6 sm:p-8"><div className="flex flex-col gap-4 sm:flex-row sm:items-end"><div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800"><p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Feature detector</p><p className="mt-1 font-semibold">SIFT — stronger matching</p></div><label className="text-sm font-semibold text-slate-700">RANSAC threshold<input type="number" min="1" max="10" step="0.5" value={ransacThreshold} onChange={(event) => changeRansacThreshold(event.target.value)} onBlur={() => { if (thresholdValidationPendingRef.current && filesRef.current.length) void selectFiles(filesRef.current, algorithm, ransacThreshold); }} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal outline-none sm:w-40" /></label><button type="button" onClick={() => void generatePanorama()} disabled={!readyToGenerate || generating} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40 sm:ml-auto">{generating ? <LoaderCircle className="animate-spin" size={18} /> : <Images size={18} />}{generating ? "Reconstructing room…" : "Generate virtual tour"}</button></div>{files.length > 0 && <p className={`mt-4 text-xs ${readyToGenerate ? "text-emerald-700" : "text-slate-500"}`}>{readyToGenerate ? `Preflight complete with ${files.length} images and ${warningIssues} non-blocking warning${warningIssues === 1 ? "" : "s"}.` : `${files.length}/${MIN_CAPTURE_IMAGES} minimum images · ${blockingIssues} critical issue${blockingIssues === 1 ? "" : "s"} to resolve.`}</p>}</div>
          </section>

          <aside className="space-y-5">
            <section className="rounded-3xl bg-slate-900 p-6 text-white"><ImageIcon className="text-blue-300" size={25} /><h2 className="mt-5 text-lg font-semibold">Capture checklist</h2><ul className="mt-4 space-y-3 text-sm leading-5 text-white/70"><Tip>Stand in one position.</Tip><Tip>Keep your phone in landscape mode.</Tip><Tip>Rotate slowly in one direction.</Tip><Tip>Keep level for the surrounding ring, then tilt up and down without moving the lens position.</Tip><Tip>Cover directly overhead and below with overlapping top/bottom photos.</Tip><Tip>Avoid zooming.</Tip><Tip>Keep 30–50% scene overlap.</Tip></ul></section>
            <section className="rounded-3xl border border-slate-200 bg-white p-5"><p className="text-sm font-semibold text-slate-900">Need documentation photos?</p><p className="mt-2 text-xs leading-5 text-slate-500">Gallery uploads are separate and are not stitched. Add overlapping ceiling and floor photos here to include them in the tour.</p><Link href="/broker/upload-images" className="mt-4 inline-flex text-xs font-semibold text-blue-600">Go to gallery upload <ChevronRight size={15} /></Link></section>
            <section className="rounded-3xl border border-blue-100 bg-blue-50 p-5"><div className="flex gap-3"><Info className="shrink-0 text-blue-600" size={20} /><div><p className="text-sm font-semibold text-blue-900">Why overlap matters</p><p className="mt-2 text-xs leading-5 text-blue-800/75">LiBot finds common visual features across your image set. All views need to connect through shared detail so they can align into one panorama.</p></div></div></section>
          </aside>
        </div>

        <section className="mt-8 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Step 3</p><h2 className="mt-2 text-xl font-semibold">Review the reconstructed room</h2></div>{quality && <span className={`w-fit rounded-full px-3 py-1.5 text-xs font-semibold ${quality.style}`}>{quality.label}</span>}</div>
          {metrics?.coverage_report && <CaptureCoverage report={metrics.coverage_report} />}
          <div className="p-4 sm:p-8">{panorama ? <><PanoramaViewer panorama={panorama} caption={`${roomType.trim()} virtual tour`} />{metrics && <><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4"><Metric label="Confidence" value={`${((metrics.reconstruction_confidence ?? 0) * 100).toFixed(1)}%`} /><Metric label="Evidence coverage" value={`${((metrics.evidence_coverage_ratio ?? 0) * 100).toFixed(1)}%`} /><Metric label="Mean inliers" value={`${((metrics.average_inlier_ratio ?? 0) * 100).toFixed(1)}%`} /><Metric label="AI-filled area" value={`${((metrics.ai_filled_ratio ?? 0) * 100).toFixed(1)}%`} /></div><div className={`mt-4 flex gap-3 rounded-2xl border p-4 text-sm ${metrics.ai_completion_used ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}><Info className="mt-0.5 shrink-0" size={19} /><div><p className="font-semibold">Reconstruction disclosure</p><p className="mt-1 leading-6">{metrics.disclosure_message}</p>{metrics.ai_completion_used && <a href={aiMaskUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex font-semibold underline">View generated-region mask</a>}</div></div></>}<div className="mt-6 flex flex-col gap-3 border-t border-slate-200 pt-6 sm:flex-row sm:justify-between"><button onClick={() => { setPanorama(""); setAiMaskUrl(""); setMetrics(null); setPublished(false); }} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"><RotateCcw size={17} />Recapture or regenerate</button><button onClick={() => void publishRoomTour()} disabled={publishing || published} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">{publishing ? <LoaderCircle className="animate-spin" size={18} /> : published ? <CheckCircle2 size={18} /> : <Eye size={18} />}{publishing ? "Publishing…" : published ? "Published" : "Publish room tour"}</button></div></> : <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 text-center"><span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm"><ImageIcon size={27} /></span><p className="mt-4 font-semibold">Your immersive preview will appear here</p><p className="mt-2 max-w-md text-sm leading-6 text-slate-500">Complete the room details, add overlapping images, and generate the tour.</p></div>}</div>
        </section>

        {published && <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-end"><Link href="/broker/properties" className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">Manage properties<ChevronRight size={17} /></Link><button onClick={reset} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white">Create another room tour<ChevronRight size={17} /></button></div>}
      </main>
      {cameraOpen && <PhoneCameraCapture captureView={captureView} imageNumber={files.length + 1} previousHeading={lastCaptureHeading} onCapture={async (file, capturedHeading) => { const accepted = await addCapture(file); if (accepted && capturedHeading != null) setLastCaptureHeading(capturedHeading); return accepted; }} onClose={() => setCameraOpen(false)} />}
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

function Tip({ children }: { children: React.ReactNode }) { return <li className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-emerald-300" /><span>{children}</span></li>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-slate-50 p-4"><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p><p className="mt-1 text-sm font-semibold text-slate-800">{value}</p></div>; }
