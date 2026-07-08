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
  algorithm: string;
  image_count: number;
  output_width: number;
  output_height: number;
  total_processing_ms: number;
  reconstruction_confidence: number;
  evidence_coverage_ratio: number;
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

const API_URL = process.env.NEXT_PUBLIC_PANORAMA_API_URL
  || (process.env.NODE_ENV === "production" ? "/api/backend" : "http://127.0.0.1:8000");

export async function reconstructHybridPanorama(
  files: File[],
  options: { algorithm: "orb" | "sift"; ransacThreshold: number; fillGaps?: boolean },
): Promise<HybridReconstruction> {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  formData.append("algorithm", options.algorithm);
  formData.append("ransac_threshold", String(options.ransacThreshold));
  formData.append("fill_gaps", String(options.fillGaps ?? true));
  const response = await fetch(`${API_URL}/reconstruct/hybrid`, { method: "POST", body: formData });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.detail || "Hybrid panorama reconstruction failed.");
  return {
    panoramaUrl: `${API_URL}${data.panorama_url}`,
    aiMaskUrl: `${API_URL}${data.ai_mask_url}`,
    metadata: data.metadata,
  };
}
