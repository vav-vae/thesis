import { auth } from "@/lib/firebase";
import { readJsonResponse } from "./http-response";
import { readProgressStream } from "./progress-stream";
import type { CaptureView } from "./capture-guide";

export type QualityIssue = {
  severity: "warning" | "error";
  code: string;
  message: string;
};

export type OverlapReport = {
  from_index: number;
  to_index: number;
  good_matches: number;
  inliers: number;
  inlier_ratio: number;
  issues: QualityIssue[];
};

export type RansacReport = {
  pair: number;
  keypoints_base: number;
  keypoints_next: number;
  candidate_matches: number;
  good_matches: number;
  inliers: number;
  inlier_ratio: number;
  processing_ms: number;
};

export type AiGeneratedRegion = {
  id: string;
  pixel_bounds: { x: number; y: number; width: number; height: number };
  normalized_bounds: { x: number; y: number; width: number; height: number };
  pixel_count: number;
  canvas_ratio: number;
  source: "ai_placeholder" | "missing";
};

export type HybridMetadata = {
  projection?: string;
  spherical_projection?: boolean;
  algorithm: string;
  image_count: number;
  output_width: number;
  output_height: number;
  total_processing_ms: number;
  reconstruction_confidence: number;
  evidence_coverage_ratio: number;
  coverage_report?: {
    top_coverage_ratio: number;
    bottom_coverage_ratio: number;
    around_coverage_ratio: number;
    missing_ratio: number;
  };
  average_inlier_ratio: number;
  overlap_report: OverlapReport[];
  ransac_report: RansacReport[];
  ai_completion_used: boolean;
  ai_completion_method: string;
  ai_generated_regions: AiGeneratedRegion[];
  unresolved_missing_regions: AiGeneratedRegion[];
  ai_filled_ratio: number;
  disclosure_message: string;
};

export type HybridReconstruction = {
  panoramaUrl: string;
  aiMaskUrl: string;
  metadata: HybridMetadata;
};

export const PANORAMA_API_URL = process.env.NEXT_PUBLIC_PANORAMA_API_URL
  || (process.env.NODE_ENV === "production" ? "/api/backend" : "http://127.0.0.1:8000");

const BUSY_RETRY_LIMIT = 6;
const BUSY_RETRY_SECONDS = 5;

function wait(milliseconds: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal?.reason ?? new DOMException("The request was aborted.", "AbortError"));
      return;
    }

    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason ?? new DOMException("The request was aborted.", "AbortError"));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

const resolveAssetUrl = (value: string) => /^https:\/\//i.test(value) ? value : `${PANORAMA_API_URL}${value}`;

async function firebaseAuthorization(forceRefresh = false): Promise<string> {
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in before using the panorama processor.");
  return `Bearer ${await user.getIdToken(forceRefresh)}`;
}

export async function panoramaApiFetch(path: string, init: RequestInit): Promise<Response> {
  const request = async (forceRefresh = false) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", await firebaseAuthorization(forceRefresh));
    return fetch(`${PANORAMA_API_URL}${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });
  };

  let forceRefresh = false;
  for (let attempt = 0; ; attempt += 1) {
    const response = await request(forceRefresh);
    if (response.status === 401 && auth.currentUser && !forceRefresh) {
      forceRefresh = true;
      continue;
    }

    const processorBusy = response.status === 503
      && response.headers.get("X-Panorama-Capacity") === "busy";
    if (!processorBusy || attempt >= BUSY_RETRY_LIMIT) return response;

    const retryAfter = Number(response.headers.get("Retry-After"));
    const retrySeconds = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter, BUSY_RETRY_SECONDS)
      : BUSY_RETRY_SECONDS;
    await wait(retrySeconds * 1000, init.signal);
  }
}

export async function panoramaApiError(response: Response, fallback: string): Promise<Error> {
  try {
    await readJsonResponse(response, fallback);
  } catch (error) {
    return error instanceof Error ? error : new Error(fallback);
  }
  return new Error(fallback);
}

export async function reconstructHybridPanorama(
  imageUrls: string[],
  options: { algorithm: "orb" | "sift"; ransacThreshold: number; fillGaps?: boolean; captureViews?: CaptureView[]; onProgress?: (stage: string) => void },
): Promise<HybridReconstruction> {
  const response = await panoramaApiFetch("/reconstruct/hybrid/remote", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify({
      image_urls: imageUrls,
      algorithm: options.algorithm,
      ransac_threshold: options.ransacThreshold,
      fill_gaps: options.fillGaps ?? true,
      capture_views: options.captureViews,
    }),
  });
  if (!response.ok) throw await panoramaApiError(response, "Hybrid panorama reconstruction failed.");
  type HybridApiResponse = { success: boolean; detail?: string; panorama_url: string; ai_mask_url: string; metadata: HybridMetadata };
  const data = response.headers.get("content-type")?.includes("application/x-ndjson")
    ? await readProgressStream<HybridApiResponse>(response, options.onProgress)
    : await readJsonResponse<HybridApiResponse>(response, "Hybrid panorama reconstruction failed.");
  if (!data.success) throw new Error(data.detail || "Hybrid panorama reconstruction failed.");
  return {
    panoramaUrl: resolveAssetUrl(data.panorama_url),
    aiMaskUrl: resolveAssetUrl(data.ai_mask_url),
    metadata: data.metadata,
  };
}
