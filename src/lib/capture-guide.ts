export type CaptureView = "around" | "top" | "bottom";

export const MIN_CAPTURE_IMAGES = 6;
export const MAX_CAPTURE_IMAGES = 24;
export const CAPTURE_VIEWS: CaptureView[] = ["around", "top", "bottom"];
export const CAPTURE_GUIDE = {
  around: {
    label: "Around / walls",
    title: "Capture the surrounding view",
    direction: "Keep the camera level and rotate from one fixed position. Complete a full circle with 30–50% overlap, including the last and first views.",
  },
  top: {
    label: "Top / ceiling",
    title: "Tilt up toward the ceiling or sky",
    direction: "Start with an upward-tilted view that still includes wall or roof detail. Rotate to cover the upper ring, then tilt farther up to capture directly overhead. Keep 30–50% overlap between rows; add bridging photos when needed.",
  },
  bottom: {
    label: "Bottom / floor",
    title: "Tilt down toward the floor or ground",
    direction: "Start with a downward-tilted view that still includes wall or nearby scene detail. Rotate to cover the lower ring, then capture directly below. Keep the lens at the same position and 30–50% overlap between rows; avoid your feet or tripod when possible.",
  },
} as const;

// Rear camera points along the negative device Z axis. Its vertical component
// is -cos(beta)*cos(gamma), independent of portrait/landscape screen rotation.
export function rearCameraPitch(beta: number | null, gamma: number | null): number | null {
  if (beta == null || gamma == null || !Number.isFinite(beta) || !Number.isFinite(gamma)) return null;
  const vertical = -Math.cos(beta * Math.PI / 180) * Math.cos(gamma * Math.PI / 180);
  return Math.asin(Math.max(-1, Math.min(1, vertical))) * 180 / Math.PI;
}
