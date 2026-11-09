"""Feature-based panorama reconstruction using ORB/SIFT and RANSAC."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from time import perf_counter
from typing import Literal, Sequence

import cv2
import numpy as np

from .spherical import SphericalMatches, prepare_spherical_matches

Algorithm = Literal["orb", "sift"]


class StitchingError(ValueError):
    """Raised when input images cannot be aligned reliably."""


@dataclass
class PairMetrics:
    pair: int
    keypoints_base: int
    keypoints_next: int
    candidate_matches: int
    good_matches: int
    inliers: int
    inlier_ratio: float
    processing_ms: float


def _issue(severity: str, code: str, message: str) -> dict:
    return {"severity": severity, "code": code, "message": message}


def analyze_image_sequence(
    images: Sequence[np.ndarray],
    filenames: Sequence[str] | None = None,
    algorithm: Algorithm = "sift",
    ransac_threshold: float = 4.0,
    *,
    prepared: SphericalMatches | None = None,
) -> dict:
    """Assess quality and connected overlap using the reconstruction matcher."""
    if not 2 <= len(images) <= 30:
        raise StitchingError("Upload between 2 and 30 overlapping images.")

    algorithm = algorithm.lower()  # type: ignore[assignment]
    if algorithm not in ("orb", "sift"):
        raise StitchingError("Algorithm must be either 'orb' or 'sift'.")
    if not 1.0 <= ransac_threshold <= 10.0:
        raise StitchingError("RANSAC threshold must be between 1.0 and 10.0 pixels.")

    if prepared is None:
        detector, norm, ratio_threshold = _detector_and_norm(algorithm)
        prepared = prepare_spherical_matches(
            images, detector, norm, ratio_threshold, ransac_threshold
        )
    names = list(filenames or [f"Image {index}" for index in range(1, len(images) + 1)])
    image_results: list[dict] = []

    for index, image in enumerate(images):
        height, width = image.shape[:2]
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        blur_score = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        brightness = float(gray.mean())
        detected_keypoints = prepared.features[index].keypoints
        issues: list[dict] = []

        if width <= height:
            issues.append(_issue("error", "orientation_portrait", "Use a landscape image with width greater than height."))
        if min(width, height) < 480:
            issues.append(_issue("error", "resolution_too_low", "Resolution is too low; use at least 640×480."))
        elif min(width, height) < 720:
            issues.append(_issue("warning", "resolution_low", "Higher resolution is recommended for a sharper tour."))
        if blur_score < 45:
            issues.append(_issue("error", "blur_severe", "Image is severely blurred; retake it with a steady camera."))
        elif blur_score < 90:
            issues.append(_issue("warning", "blur_possible", "Image may be blurry; inspect focus before continuing."))
        if brightness < 35:
            issues.append(_issue("error", "underexposed", "Image is too dark for reliable feature detection."))
        elif brightness < 60:
            issues.append(_issue("warning", "dark", "Image is dark; add light or increase exposure."))
        elif brightness > 225:
            issues.append(_issue("error", "overexposed", "Image is too bright and has lost useful detail."))
        elif brightness > 200:
            issues.append(_issue("warning", "bright", "Image is very bright; reduce exposure if details are washed out."))
        if len(detected_keypoints) < 40:
            issues.append(_issue("error", "features_insufficient", "Too few visual features were detected for alignment."))
        elif len(detected_keypoints) < 120:
            issues.append(_issue("warning", "features_weak", "Few visual features were detected; include more textured detail."))

        image_results.append({
            "index": index,
            "filename": names[index] if index < len(names) else f"Image {index + 1}",
            "width": width,
            "height": height,
            "blur_score": round(blur_score, 2),
            "brightness": round(brightness, 2),
            "keypoints": len(detected_keypoints),
            "issues": issues,
        })

    pair_results: list[dict] = []
    # Only report actual links. Two uploads need not overlap directly when
    # other images provide a reliable path between them.
    for report in prepared.reports:
        issues: list[dict] = []
        if report["good_matches"] < 25 or report["inlier_ratio"] < 0.3:
            issues.append(_issue("warning", "overlap_weak", "Overlap is weak and may create visible seams."))
        pair_results.append({
            **{key: report[key] for key in (
                "from_index", "to_index", "good_matches", "inliers", "inlier_ratio"
            )},
            "issues": issues,
        })

    graph_issues: list[dict] = []
    connected = len(prepared.components) == 1
    if not connected:
        groups = " / ".join(
            "[" + ", ".join(str(index + 1) for index in group) + "]"
            for group in prepared.components
        )
        graph_issues.append(_issue(
            "error", "overlap_disconnected",
            f"These image groups do not have reliable overlap: {groups}. "
            "Add or retake photos bridging the groups with 30–50% shared content.",
        ))
    all_issues = [issue for item in image_results for issue in item["issues"]]
    all_issues.extend(issue for pair in pair_results for issue in pair["issues"])
    all_issues.extend(graph_issues)
    errors = sum(issue["severity"] == "error" for issue in all_issues)
    warnings = sum(issue["severity"] == "warning" for issue in all_issues)
    return {
        "algorithm": algorithm.upper(),
        "can_stitch": errors == 0,
        "summary": {"errors": errors, "warnings": warnings},
        "images": image_results,
        "pairs": pair_results,
        "issues": graph_issues,
        "overlap_graph": {"connected": connected, "components": prepared.components},
    }


def _detector_and_norm(algorithm: Algorithm):
    if algorithm == "orb":
        return cv2.ORB_create(nfeatures=7000, scaleFactor=1.2, nlevels=8), cv2.NORM_HAMMING, 0.78
    if algorithm == "sift":
        if not hasattr(cv2, "SIFT_create"):
            raise StitchingError("SIFT is unavailable in this OpenCV installation.")
        return cv2.SIFT_create(nfeatures=7000), cv2.NORM_L2, 0.75
    raise StitchingError("Algorithm must be either 'orb' or 'sift'.")


def _ratio_matches(candidates, threshold: float) -> list:
    """Sparse descriptors may yield fewer than two neighbours."""
    return [pair[0] for pair in candidates
            if len(pair) == 2 and pair[0].distance < threshold * pair[1].distance]


def _crop_to_content(image: np.ndarray, mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    points = cv2.findNonZero(mask)
    if points is None:
        raise StitchingError("The stitched image contains no visible pixels.")
    x, y, width, height = cv2.boundingRect(points)
    return image[y:y + height, x:x + width], mask[y:y + height, x:x + width]


def _blend(base: np.ndarray, warped: np.ndarray, base_mask: np.ndarray, warped_mask: np.ndarray) -> np.ndarray:
    """Feather overlapping pixels while preserving non-overlap regions."""
    base_weight = cv2.distanceTransform(base_mask, cv2.DIST_L2, 3) + (base_mask > 0).astype(np.float32)
    warped_weight = cv2.distanceTransform(warped_mask, cv2.DIST_L2, 3) + (warped_mask > 0).astype(np.float32)
    total = base_weight + warped_weight
    base_ratio = np.divide(base_weight, total, out=np.zeros_like(base_weight), where=total > 0)
    warped_ratio = np.divide(warped_weight, total, out=np.zeros_like(warped_weight), where=total > 0)
    result = base.astype(np.float32) * base_ratio[..., None] + warped.astype(np.float32) * warped_ratio[..., None]
    return np.clip(result, 0, 255).astype(np.uint8)


def _stitch_pair(
    base: np.ndarray,
    next_image: np.ndarray,
    algorithm: Algorithm,
    pair_index: int,
    ransac_threshold: float,
    evidence_mask: np.ndarray | None = None,
) -> tuple[np.ndarray, np.ndarray, PairMetrics]:
    started = perf_counter()
    detector, norm, ratio_threshold = _detector_and_norm(algorithm)
    gray_base = cv2.cvtColor(base, cv2.COLOR_BGR2GRAY)
    gray_next = cv2.cvtColor(next_image, cv2.COLOR_BGR2GRAY)
    keypoints_base, descriptors_base = detector.detectAndCompute(gray_base, evidence_mask)
    keypoints_next, descriptors_next = detector.detectAndCompute(gray_next, None)

    if descriptors_base is None or descriptors_next is None:
        raise StitchingError(f"Image pair {pair_index} has too few detectable features.")

    matcher = cv2.BFMatcher(norm)
    candidate_matches = matcher.knnMatch(descriptors_next, descriptors_base, k=2)
    good_matches = _ratio_matches(candidate_matches, ratio_threshold)
    if len(good_matches) < 10:
        raise StitchingError(
            f"Image pair {pair_index} has only {len(good_matches)} reliable matches; at least 10 are required. "
            "Capture images with 30–40% overlap and consistent lighting."
        )

    source = np.float32([keypoints_next[match.queryIdx].pt for match in good_matches]).reshape(-1, 1, 2)
    destination = np.float32([keypoints_base[match.trainIdx].pt for match in good_matches]).reshape(-1, 1, 2)
    homography, inlier_mask = cv2.findHomography(source, destination, cv2.RANSAC, ransac_threshold)
    if homography is None or inlier_mask is None:
        raise StitchingError(f"RANSAC could not estimate a homography for image pair {pair_index}.")

    inliers = int(inlier_mask.ravel().sum())
    inlier_ratio = inliers / len(good_matches)
    if inliers < 8 or inlier_ratio < 0.25:
        raise StitchingError(
            f"Image pair {pair_index} alignment is unreliable ({inliers} inliers, {inlier_ratio:.1%} inlier ratio)."
        )

    base_height, base_width = base.shape[:2]
    next_height, next_width = next_image.shape[:2]
    base_corners = np.float32([[0, 0], [base_width, 0], [base_width, base_height], [0, base_height]]).reshape(-1, 1, 2)
    next_corners = np.float32([[0, 0], [next_width, 0], [next_width, next_height], [0, next_height]]).reshape(-1, 1, 2)
    # A projective horizon crossing the image produces an unbounded warp even
    # when the four transformed corners happen to have finite coordinates.
    denominators = np.c_[next_corners.reshape(-1, 2), np.ones(4)] @ homography[2]
    if (not np.isfinite(homography).all() or
            not (np.all(denominators > 1e-8) or np.all(denominators < -1e-8))):
        raise StitchingError(f"Image pair {pair_index} produced an invalid projective warp.")
    transformed_next = cv2.perspectiveTransform(next_corners, homography)
    if not np.isfinite(transformed_next).all() or np.max(np.abs(transformed_next)) > 120_000_000:
        raise StitchingError(f"Image pair {pair_index} produced invalid panorama bounds.")
    all_corners = np.concatenate((base_corners, transformed_next), axis=0).reshape(-1, 2)
    minimum = np.floor(all_corners.min(axis=0)).astype(int)
    maximum = np.ceil(all_corners.max(axis=0)).astype(int)
    translate_x, translate_y = max(0, -minimum[0]), max(0, -minimum[1])
    canvas_width, canvas_height = maximum[0] - minimum[0], maximum[1] - minimum[1]

    if canvas_width <= 0 or canvas_height <= 0 or canvas_width * canvas_height > 120_000_000:
        raise StitchingError(f"Image pair {pair_index} produced an invalid or excessively large panorama canvas.")

    translation = np.array([[1, 0, translate_x], [0, 1, translate_y], [0, 0, 1]], dtype=np.float64)
    warped = cv2.warpPerspective(next_image, translation @ homography, (canvas_width, canvas_height))
    warped_mask = cv2.warpPerspective(
        np.full((next_height, next_width), 255, dtype=np.uint8),
        translation @ homography,
        (canvas_width, canvas_height),
        flags=cv2.INTER_NEAREST,
    )
    base_canvas = np.zeros_like(warped)
    base_mask = np.zeros((canvas_height, canvas_width), dtype=np.uint8)
    base_canvas[translate_y:translate_y + base_height, translate_x:translate_x + base_width] = base
    if evidence_mask is None:
        evidence_mask = np.full((base_height, base_width), 255, dtype=np.uint8)
    base_mask[translate_y:translate_y + base_height, translate_x:translate_x + base_width] = evidence_mask
    combined_mask = cv2.bitwise_or(base_mask, warped_mask)
    blended = _blend(base_canvas, warped, base_mask, warped_mask)
    blended, combined_mask = _crop_to_content(blended, combined_mask)

    metrics = PairMetrics(
        pair=pair_index,
        keypoints_base=len(keypoints_base),
        keypoints_next=len(keypoints_next),
        candidate_matches=len(candidate_matches),
        good_matches=len(good_matches),
        inliers=inliers,
        inlier_ratio=round(inlier_ratio, 4),
        processing_ms=round((perf_counter() - started) * 1000, 2),
    )
    return blended, combined_mask, metrics


def stitch_images(
    images: Sequence[np.ndarray],
    algorithm: Algorithm = "sift",
    ransac_threshold: float = 4.0,
) -> tuple[np.ndarray, dict]:
    """Stitch ordered overlapping images and return the panorama plus evaluation metrics."""
    if len(images) < 2:
        raise StitchingError("Upload at least two overlapping images.")
    if len(images) > 30:
        raise StitchingError("A maximum of 30 images can be stitched at once.")
    if not 1.0 <= ransac_threshold <= 10.0:
        raise StitchingError("RANSAC threshold must be between 1.0 and 10.0 pixels.")

    algorithm = algorithm.lower()  # type: ignore[assignment]
    if algorithm not in ("orb", "sift"):
        raise StitchingError("Algorithm must be either 'orb' or 'sift'.")

    started = perf_counter()
    panorama = images[0].copy()
    evidence_mask = np.full(panorama.shape[:2], 255, dtype=np.uint8)
    pair_metrics: list[PairMetrics] = []
    for index, next_image in enumerate(images[1:], start=1):
        panorama, evidence_mask, metrics = _stitch_pair(
            panorama, next_image, algorithm, index, ransac_threshold, evidence_mask
        )
        pair_metrics.append(metrics)

    total_ms = round((perf_counter() - started) * 1000, 2)
    return panorama, {
        "algorithm": algorithm.upper(),
        "image_count": len(images),
        "total_processing_ms": total_ms,
        "output_width": int(panorama.shape[1]),
        "output_height": int(panorama.shape[0]),
        "average_inlier_ratio": round(sum(item.inlier_ratio for item in pair_metrics) / len(pair_metrics), 4),
        "pairs": [asdict(item) for item in pair_metrics],
    }


def _fit_to_equirectangular(image: np.ndarray, evidence_mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Place the evidence-backed mosaic on a 2:1 canvas without inventing geometry."""
    height, width = image.shape[:2]
    output_width = max(2048, width, height * 2)
    output_width += output_width % 2
    output_height = output_width // 2
    scale = min(output_width / width, output_height / height)
    resized_width, resized_height = max(1, int(width * scale)), max(1, int(height * scale))
    resized = cv2.resize(image, (resized_width, resized_height), interpolation=cv2.INTER_AREA)
    resized_mask = cv2.resize(evidence_mask, (resized_width, resized_height), interpolation=cv2.INTER_NEAREST)
    canvas = np.zeros((output_height, output_width, 3), dtype=np.uint8)
    canvas_mask = np.zeros((output_height, output_width), dtype=np.uint8)
    x, y = (output_width - resized_width) // 2, (output_height - resized_height) // 2
    canvas[y:y + resized_height, x:x + resized_width] = resized
    canvas_mask[y:y + resized_height, x:x + resized_width] = resized_mask
    return canvas, canvas_mask


def describe_missing_regions(evidence_mask: np.ndarray, minimum_area: int = 256) -> list[dict]:
    """Return connected missing regions as auditable pixel and normalized bounds."""
    missing = cv2.bitwise_not(evidence_mask)
    count, _, stats, _ = cv2.connectedComponentsWithStats(missing, connectivity=8)
    height, width = evidence_mask.shape
    regions: list[dict] = []
    for label in range(1, count):
        x, y, region_width, region_height, area = (int(value) for value in stats[label])
        if area < minimum_area:
            continue
        regions.append({
            "id": f"gap-{len(regions) + 1}",
            "pixel_bounds": {"x": x, "y": y, "width": region_width, "height": region_height},
            "normalized_bounds": {
                "x": round(x / width, 6), "y": round(y / height, 6),
                "width": round(region_width / width, 6), "height": round(region_height / height, 6),
            },
            "pixel_count": area,
            "canvas_ratio": round(area / (width * height), 6),
            "source": "missing",
        })
    return regions


def placeholder_ai_gap_fill(
    image: np.ndarray,
    evidence_mask: np.ndarray,
    maximum_region_ratio: float = 0.05,
) -> tuple[np.ndarray, np.ndarray, dict]:
    """Temporary gap completion hook; replace only this function with an AI provider.

    OpenCV Telea inpainting is deterministic and is not represented as real property
    evidence. Its output remains fully identified by the returned mask and metadata.
    """
    missing_mask = cv2.bitwise_not(evidence_mask)
    regions = describe_missing_regions(evidence_mask, minimum_area=1)
    _, labels = cv2.connectedComponents(missing_mask, connectivity=8)
    fill_regions = [region for region in regions if region["canvas_ratio"] <= maximum_region_ratio]
    unresolved_regions = [region for region in regions if region["canvas_ratio"] > maximum_region_ratio]
    fill_mask = np.zeros_like(evidence_mask)
    for region in fill_regions:
        # Bounds can contain another disconnected (possibly large) gap. Select
        # the exact component, never all missing pixels in its bounding box.
        component_id = int(region["id"].split("-")[1])
        fill_mask[labels == component_id] = 255
        region["source"] = "ai_placeholder"
    if not np.any(missing_mask):
        return image.copy(), fill_mask, {"used": False, "method": "none", "regions": [], "unresolved_regions": [], "filled_ratio": 0.0}
    # Inpainting is intentionally bounded to nearby pixels. Large unsupported areas
    # remain visibly low-confidence and must not be treated as factual evidence.
    completed = cv2.inpaint(image, fill_mask, 3, cv2.INPAINT_TELEA) if np.any(fill_mask) else image.copy()
    return completed, fill_mask, {
        "used": bool(np.any(fill_mask)),
        "method": "opencv_telea_placeholder" if np.any(fill_mask) else "none_large_gaps_preserved",
        "regions": fill_regions,
        "unresolved_regions": unresolved_regions,
        "filled_ratio": round(float(np.count_nonzero(fill_mask)) / fill_mask.size, 6),
    }


def reconstruct_hybrid_panorama(
    images: Sequence[np.ndarray],
    filenames: Sequence[str] | None = None,
    algorithm: Algorithm = "sift",
    ransac_threshold: float = 4.0,
    fill_gaps: bool = True,
    capture_views: Sequence[str] | None = None,
) -> tuple[np.ndarray, np.ndarray, dict]:
    """Reconstruct from real matches first, then complete only pixels without evidence."""
    if not 6 <= len(images) <= 24:
        raise StitchingError("Guided hybrid reconstruction requires 6 to 24 landscape images.")
    if capture_views is not None and (len(capture_views) != len(images) or any(view not in {"around", "top", "bottom"} for view in capture_views)):
        raise StitchingError("Provide one valid capture view (around, top, bottom) for each image.")
    if not 1.0 <= ransac_threshold <= 10.0:
        raise StitchingError("RANSAC threshold must be between 1.0 and 10.0 pixels.")
    started = perf_counter()
    detector, norm, ratio_threshold = _detector_and_norm(algorithm)
    prepared = prepare_spherical_matches(
        images, detector, norm, ratio_threshold, ransac_threshold
    )
    analysis = analyze_image_sequence(
        images, filenames, algorithm, ransac_threshold, prepared=prepared
    )
    if not analysis["can_stitch"]:
        if analysis["issues"]:
            raise StitchingError(analysis["issues"][0]["message"])
        raise StitchingError("Image quality or overlap validation failed. Retake the flagged images before reconstruction.")

    from .spherical import reconstruct_sphere
    panorama, evidence_mask, pair_reports, camera_report = reconstruct_sphere(
        images, detector, norm, ratio_threshold, ransac_threshold, prepared=prepared,
        capture_views=capture_views,
    )
    if fill_gaps:
        final, generated_mask, completion = placeholder_ai_gap_fill(panorama, evidence_mask)
    else:
        final = panorama
        generated_mask = np.zeros_like(evidence_mask)
        completion = {
            "used": False,
            "method": "disabled",
            "regions": [],
            "unresolved_regions": describe_missing_regions(evidence_mask, minimum_area=1),
            "filled_ratio": 0.0,
        }

    average_inlier = sum(item['inlier_ratio'] for item in pair_reports) / len(pair_reports)
    evidence_ratio = float(np.count_nonzero(evidence_mask)) / evidence_mask.size
    confidence = max(0.0, min(1.0, average_inlier * 0.65 + evidence_ratio * 0.35))
    disclosure = (
        "Some missing regions were completed by an inpainting placeholder and may not represent exact property details. "
        "The generated mask identifies filled pixels; unresolved missing regions remain unsupported."
        if completion["used"] else
        "This panorama is reconstructed from uploaded-image evidence; no completion was applied. Uncaptured areas remain blank."
    )
    metadata = {
        "algorithm": algorithm.upper(),
        "projection": "equirectangular",
        "spherical_projection": True,
        "camera_report": camera_report,
        "coverage_report": camera_report["coverage_report"],
        "capture_views": list(capture_views) if capture_views is not None else None,
        "pipeline": ["ORB feature detection" if algorithm == "orb" else "SIFT feature detection", "BFMatcher", "RANSAC homography", "camera rotation estimation", "bundle adjustment", "spherical projection", "feather blending", "gap completion"],
        "image_count": len(images),
        "output_width": int(final.shape[1]),
        "output_height": int(final.shape[0]),
        "total_processing_ms": round((perf_counter() - started) * 1000, 2),
        "reconstruction_confidence": round(confidence, 4),
        "evidence_coverage_ratio": round(evidence_ratio, 6),
        "average_inlier_ratio": round(average_inlier, 4),
        "overlap_report": analysis["pairs"],
        "ransac_report": pair_reports,
        "ai_completion_used": completion["used"],
        "ai_completion_method": completion["method"],
        "ai_generated_regions": completion["regions"],
        "unresolved_missing_regions": completion["unresolved_regions"],
        "ai_filled_ratio": completion["filled_ratio"],
        "disclosure_message": disclosure,
    }
    return final, generated_mask, metadata


def build_four_view_panorama(
    front: np.ndarray,
    left: np.ndarray,
    right: np.ndarray,
    top: np.ndarray,
    output_width: int = 2048,
) -> tuple[np.ndarray, dict]:
    """Project four directional cube faces into a partial 2:1 equirectangular panorama.

    Back and bottom are intentionally left unfilled because those directions were not captured.
    This is a directional-view prototype rather than feature-based multi-image stitching.
    """
    if output_width < 1024 or output_width > 8192 or output_width % 2:
        raise StitchingError("Output width must be an even value between 1024 and 8192 pixels.")
    faces = {"front": front, "left": left, "right": right, "top": top}
    if any(image is None or image.size == 0 for image in faces.values()):
        raise StitchingError("All four directional images are required.")

    started = perf_counter()
    output_height = output_width // 2
    longitude = np.linspace(-np.pi, np.pi, output_width, endpoint=False, dtype=np.float32)
    latitude = np.linspace(np.pi / 2, -np.pi / 2, output_height, dtype=np.float32)
    lon, lat = np.meshgrid(longitude, latitude)
    direction_x = np.cos(lat) * np.sin(lon)
    direction_y = np.sin(lat)
    direction_z = np.cos(lat) * np.cos(lon)
    absolute_x, absolute_y, absolute_z = np.abs(direction_x), np.abs(direction_y), np.abs(direction_z)
    major = np.maximum(np.maximum(absolute_x, absolute_y), absolute_z)

    face_rules = {
        "front": (absolute_z == major) & (direction_z > 0),
        "right": (absolute_x == major) & (direction_x > 0),
        "left": (absolute_x == major) & (direction_x < 0),
        "top": (absolute_y == major) & (direction_y > 0),
    }
    panorama = np.zeros((output_height, output_width, 3), dtype=np.uint8)
    coverage_mask = np.zeros((output_height, output_width), dtype=np.uint8)

    for name, image in faces.items():
        mask = face_rules[name]
        denominator = {
            "front": direction_z,
            "right": direction_x,
            "left": -direction_x,
            "top": direction_y,
        }[name]
        with np.errstate(divide="ignore", invalid="ignore"):
            if name == "front":
                cube_u, cube_v = direction_x / denominator, -direction_y / denominator
            elif name == "right":
                cube_u, cube_v = -direction_z / denominator, -direction_y / denominator
            elif name == "left":
                cube_u, cube_v = direction_z / denominator, -direction_y / denominator
            else:
                cube_u, cube_v = direction_x / denominator, direction_z / denominator

        image_height, image_width = image.shape[:2]
        map_x = ((cube_u + 1) * 0.5 * (image_width - 1)).astype(np.float32)
        map_y = ((cube_v + 1) * 0.5 * (image_height - 1)).astype(np.float32)
        projected = cv2.remap(image, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
        panorama[mask] = projected[mask]
        coverage_mask[mask] = 255

    coverage = float(np.count_nonzero(coverage_mask)) / coverage_mask.size
    return panorama, {
        "projection": "partial-equirectangular",
        "provided_faces": list(faces.keys()),
        "missing_faces": ["back", "bottom"],
        "coverage_ratio": round(coverage, 4),
        "output_width": output_width,
        "output_height": output_height,
        "processing_ms": round((perf_counter() - started) * 1000, 2),
    }
