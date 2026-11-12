export type CaptureView = "around" | "top" | "bottom";
export type CapturePhase = "bridge" | "ring" | "pole";

export const MIN_CAPTURE_IMAGES = 6;
export const CAPTURE_STEPS = [
  { id: "around:ring", view: "around", phase: "ring", label: "Walls · level", target: 12 },
  { id: "top:bridge", view: "top", phase: "bridge", label: "Ceiling bridge · +30°", target: 12 },
  { id: "top:ring", view: "top", phase: "ring", label: "Ceiling ring · +60°", target: 12 },
  { id: "top:pole", view: "top", phase: "pole", label: "Directly overhead · +90°", target: 1 },
  { id: "bottom:bridge", view: "bottom", phase: "bridge", label: "Floor bridge · −30°", target: 12 },
  { id: "bottom:ring", view: "bottom", phase: "ring", label: "Floor ring · −60°", target: 12 },
  { id: "bottom:pole", view: "bottom", phase: "pole", label: "Directly below · −90°", target: 1 },
] as const;
export type CaptureStepId = typeof CAPTURE_STEPS[number]["id"];
export type CaptureShotContext = { view: CaptureView; phase: CapturePhase; pitch: number | null; heading: number | null; absoluteHeading?: boolean };
export function captureStepId(view: CaptureView, phase: CapturePhase): CaptureStepId {
  return `${view}:${view === "around" ? "ring" : phase}` as CaptureStepId;
}
export const CAPTURE_TURN_STEP = 30;
export const CAPTURE_TURN_TOLERANCE = 5;
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
    direction: "Capture a circle at 30° up with wall detail still visible, then another at 60° before pointing directly overhead. Keep 30–50% overlap between rows and keep the lens in one position.",
  },
  bottom: {
    label: "Bottom / floor",
    title: "Tilt down toward the floor or ground",
    direction: "Capture a circle at 30° down with wall detail still visible, then another at 60° before pointing directly below. Keep the lens in one position and 30–50% overlap between rows; avoid your feet or tripod when possible.",
  },
} as const;

// Rear camera points along the negative device Z axis. Its vertical component
// is -cos(beta)*cos(gamma), independent of portrait/landscape screen rotation.
export function rearCameraPitch(beta: number | null, gamma: number | null): number | null {
  if (beta == null || gamma == null || !Number.isFinite(beta) || !Number.isFinite(gamma)) return null;
  const vertical = -Math.cos(beta * Math.PI / 180) * Math.cos(gamma * Math.PI / 180);
  return Math.asin(Math.max(-1, Math.min(1, vertical))) * 180 / Math.PI;
}

export function normalizeHeading(value: number): number {
  return ((value % 360) + 360) % 360;
}

export function shortestTurn(from: number, to: number): number {
  return normalizeHeading(to - from + 180) - 180;
}

// Project the rear lens direction onto the horizontal plane using Z-X-Y
// device rotations (https://www.w3.org/TR/orientation-event/#worked-example).
// This also works in landscape, where 360 - alpha alone is not lens heading.
// Relative alpha is sufficient for turns within one uninterrupted session.
export function rearCameraHeading(alpha: number | null, beta: number | null, gamma: number | null): number | null {
  if (alpha == null || beta == null || gamma == null || ![alpha, beta, gamma].every(Number.isFinite)) return null;
  const [a, b, g] = [alpha, beta, gamma].map((angle) => angle * Math.PI / 180);
  const x = -Math.cos(a) * Math.sin(g) - Math.sin(a) * Math.sin(b) * Math.cos(g);
  const y = -Math.sin(a) * Math.sin(g) + Math.cos(a) * Math.sin(b) * Math.cos(g);
  // Heading is undefined when looking almost straight up or down.
  if (Math.hypot(x, y) < 0.1) return null;
  return normalizeHeading(Math.atan2(x, y) * 180 / Math.PI);
}

export function captureTargetPitch(view: CaptureView, phase: CapturePhase = "bridge"): number {
  if (view === "around") return 0;
  return (view === "top" ? 1 : -1) * (phase === "pole" ? 90 : phase === "ring" ? 60 : 30);
}

export function capturePitchReady(view: CaptureView, pitch: number | null, phase: CapturePhase = "bridge"): boolean {
  if (pitch == null || !Number.isFinite(pitch) || Math.abs(pitch) > 90) return false;
  return Math.abs(captureTargetPitch(view, phase) - pitch) <= 5;
}

export function captureAlignment(view: CaptureView, phase: CapturePhase, pitch: number | null, heading: number | null, previousHeading: number | null) {
  const targetPitch = captureTargetPitch(view, phase);
  const pitchError = pitch != null && Number.isFinite(pitch) && Math.abs(pitch) <= 90 ? targetPitch - pitch : null;
  const isPole = view !== "around" && phase === "pole";
  const validHeading = heading != null && Number.isFinite(heading);
  const targetHeading = !isPole && previousHeading != null && Number.isFinite(previousHeading) ? normalizeHeading(previousHeading + CAPTURE_TURN_STEP) : null;
  const turn = validHeading && targetHeading != null ? shortestTurn(heading, targetHeading) : null;
  const pitchReady = capturePitchReady(view, pitch, phase);
  const ready = pitchReady && (isPole || validHeading) && (targetHeading == null || (turn != null && Math.abs(turn) <= CAPTURE_TURN_TOLERANCE));
  const direction = pitchError == null ? null : !pitchReady ? pitchError > 0 ? "up" : "down"
    : turn != null && Math.abs(turn) > CAPTURE_TURN_TOLERANCE ? turn > 0 ? "right" : "left" : null;
  const message = pitchError == null ? "Tilt data unavailable · follow the visual overlap guide"
    : !pitchReady ? `Tilt ${pitchError > 0 ? "up" : "down"} ${Math.round(Math.abs(pitchError))}° · aim for ${targetPitch}°`
    : !isPole && !validHeading ? "Turn data unavailable · check overlap visually"
    : turn != null && Math.abs(turn) > CAPTURE_TURN_TOLERANCE ? `Turn ${turn > 0 ? "right" : "left"} ${Math.round(Math.abs(turn))}° · keep this tilt`
    : isPole ? `${view === "top" ? "Overhead" : "Floor below"} ready · hold steady and check overlap`
    : "Position ready · hold steady and check overlap";
  return { targetPitch, pitchError, turn, ready, direction, message };
}

/** Retakes aim at the saved shot, never the next 30-degree capture position. */
export function retakeAlignment(view: CaptureView, phase: CapturePhase, pitch: number | null, heading: number | null, target?: CaptureShotContext, absoluteHeading = false) {
  const targetPitch = target?.pitch != null && Number.isFinite(target.pitch) && Math.abs(target.pitch) <= 90 ? target.pitch : captureTargetPitch(view, phase);
  const pitchError = pitch != null && Number.isFinite(pitch) && Math.abs(pitch) <= 90 ? targetPitch - pitch : null;
  const isPole = view !== "around" && phase === "pole";
  // Relative device headings may reset when the camera/sensor listener reopens.
  const headingAvailable = !isPole && absoluteHeading && target?.absoluteHeading === true && target.heading != null && Number.isFinite(target.heading) && heading != null && Number.isFinite(heading);
  const turn = headingAvailable ? shortestTurn(heading!, target!.heading!) : null;
  const pitchReady = pitchError != null && Math.abs(pitchError) <= 5;
  const ready = pitchReady && (isPole || (turn != null && Math.abs(turn) <= CAPTURE_TURN_TOLERANCE));
  const direction = pitchError == null ? null : !pitchReady ? pitchError > 0 ? "up" : "down" : turn != null && Math.abs(turn) > CAPTURE_TURN_TOLERANCE ? turn > 0 ? "right" : "left" : null;
  const message = pitchError == null ? "Tilt unavailable · match the original photo visually"
    : !pitchReady ? `Tilt ${pitchError > 0 ? "up" : "down"} ${Math.round(Math.abs(pitchError))}° · original target ${Math.round(targetPitch)}°`
    : !isPole && !headingAvailable ? "Tilt matched · match the original photo visually; saved compass direction unavailable"
    : turn != null && Math.abs(turn) > CAPTURE_TURN_TOLERANCE ? `Turn ${turn > 0 ? "right" : "left"} ${Math.round(Math.abs(turn))}° toward the original photo`
    : "Original direction matched · check the image and hold steady";
  return { targetPitch, pitchError, turn, ready, direction, message };
}
