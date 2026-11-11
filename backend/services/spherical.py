"""Bounded spherical reconstruction for photographs taken from one position."""
from __future__ import annotations

from dataclasses import dataclass
from time import perf_counter
from typing import Callable

import cv2
import numpy as np


@dataclass
class SphericalMatches:
    """Shared evidence for overlap validation and spherical reconstruction."""

    working: list[np.ndarray]
    features: list
    pairwise: list
    reports: list[dict]
    components: list[list[int]]


def _native_pairwise(features):
    count = len(features)
    if count and all(feature.descriptors.get() is not None and len(feature.descriptors.get()) >= 2 for feature in features):
        matcher = cv2.detail_BestOf2NearestMatcher(False, .3)
        try:
            return list(matcher.apply2(features, np.zeros((count, count), np.uint8)))
        finally:
            matcher.collectGarbage()
    return [cv2.detail.MatchesInfo() for _ in range(count * count)]


def subset_spherical_matches(prepared: SphericalMatches, indices: list[int]):
    """Retain a verified connected component without detecting/matching again."""
    features = [prepared.features[index] for index in indices]
    for index, feature in enumerate(features):
        feature.img_idx = index
    pairwise = _native_pairwise(features)
    old_count, count = len(prepared.features), len(indices)
    for first, old_first in enumerate(indices):
        for second, old_second in enumerate(indices):
            source = prepared.pairwise[old_first * old_count + old_second]
            if source.confidence <= 0:
                continue
            target = pairwise[first * count + second]
            target.src_img_idx, target.dst_img_idx = first, second
            target.H, target.confidence, target.num_inliers = source.H, source.confidence, source.num_inliers
            target.matches, target.inliers_mask = source.getMatches(), source.getInliers()
    remap = {original: index for index, original in enumerate(indices)}
    reports = [
        {**report, "from_index": remap[report["from_index"]], "to_index": remap[report["to_index"]]}
        for report in prepared.reports
        if report["from_index"] in remap and report["to_index"] in remap
    ]
    return SphericalMatches([prepared.working[index] for index in indices], features, pairwise, reports, [list(range(count))])


def _alignment_sample(matches, mask, keypoints, image_size, limit=200):
    """Keep spatially spread verified points for the camera optimizer.

    Thousands of repeated features in every overlapping pair make bundle
    adjustment grow needlessly with a dense phone sweep. Quality reports still
    use all matches; only the optimizer's residuals are sampled.
    """
    inliers = [match for match, valid in zip(matches, mask.ravel()) if valid]
    if len(inliers) <= limit:
        return inliers
    cells = {}
    width, height = image_size
    for match in sorted(inliers, key=lambda item: item.distance):
        x, y = keypoints[match.queryIdx]
        cells.setdefault((min(15, int(x * 16 / width)), min(11, int(y * 12 / height))), match)
    selected = list(cells.values())[:limit]
    selected_ids = {match.queryIdx for match in selected}
    if len(selected) < limit:
        selected.extend(match for match in inliers if match.queryIdx not in selected_ids)
    return selected[:limit]


def _rotation_condition(homography, first_size, second_size):
    """Reject collapsed/reflected projective fits before they poison poses.

    A rotating pinhole camera has H = K2 R K1^-1. After plausible focal
    normalization its singular values must be comparable. Repeating slats
    can otherwise create numerically invertible, almost rank-one matrices
    with dozens of apparent RANSAC inliers.
    """
    if not np.isfinite(homography).all() or abs(homography[2, 2]) < 1e-10:
        return float('inf')
    normalized = homography / homography[2, 2]
    if np.linalg.det(normalized) <= 0:
        return float('inf')
    best = float('inf')
    for scale in (.35, .5, .7, 1., 1.5, 2.5):
        first_focal, second_focal = max(first_size) * scale, max(second_size) * scale
        matrix = np.diag([1 / second_focal, 1 / second_focal, 1]) @ normalized @ np.diag([first_focal, first_focal, 1])
        values = np.linalg.svd(matrix, compute_uv=False)
        if values[-1] > 1e-12:
            best = min(best, float(values[0] / values[-1]))
    return best


def prepare_spherical_matches(images, detector, norm, ratio_threshold, ransac_threshold=4.0, *, on_progress: Callable[[str], None] | None = None):
    """Match all source pairs at the resolution used for camera estimation.

    Reports contain accepted alignment edges only. Nonadjacent uploads can
    connect a set; absent edges are not individual image-quality failures.
    """
    working = []
    for image in images:
        height, width = image.shape[:2]
        scale = min(1.0, 1600 / max(height, width))
        working.append(cv2.resize(image, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA))
    features = []
    for index, image in enumerate(working):
        if on_progress:
            on_progress(f"Finding detail in photo {index + 1} of {len(working)}")
        feature = cv2.detail.computeImageFeatures2(detector, image)
        feature.img_idx = index
        features.append(feature)
    count = len(features)
    descriptors = [feature.descriptors.get() for feature in features]
    # Cache the Python keypoint conversion once per image. Accessing the
    # OpenCV property inside a point loop copies its entire keypoint vector.
    keypoints = [np.array([point.pt for point in feature.keypoints], np.float32) for feature in features]
    # The estimator requires matcher-owned native MatchesInfo objects. An
    # empty mask creates those objects without running a duplicate pair pass.
    pairwise = _native_pairwise(features)
    graph = [set() for _ in features]
    reports = []
    matcher = cv2.BFMatcher(norm)
    indexes = {}
    for first in range(count):
        if on_progress:
            on_progress(f"Checking overlap for photo {first + 1} of {count}")
        for second in range(first + 1, count):
            pair_started = perf_counter()
            a, b = features[first], features[second]
            first_descriptors, second_descriptors = descriptors[first], descriptors[second]
            if first_descriptors is None or second_descriptors is None:
                continue
            if len(first_descriptors) == 0 or len(second_descriptors) < 2:
                continue
            if norm == cv2.NORM_L2:
                # Reuse one SIFT search index per destination photograph.
                # Brute force compares every descriptor to every descriptor;
                # at 40 photos that repeats billions of distance operations.
                if second not in indexes:
                    search = cv2.FlannBasedMatcher(dict(algorithm=1, trees=4), dict(checks=64))
                    search.add([second_descriptors])
                    search.train()
                    indexes[second] = search
                candidates = indexes[second].knnMatch(first_descriptors, k=2)
            else:
                candidates = matcher.knnMatch(first_descriptors, second_descriptors, k=2)
            good = [pair[0] for pair in candidates if len(pair) == 2 and pair[0].distance < ratio_threshold * pair[1].distance]
            if len(good) < 10:
                continue
            source = keypoints[first][[match.queryIdx for match in good]] - np.float32(a.img_size) / 2
            target = keypoints[second][[match.trainIdx for match in good]] - np.float32(b.img_size) / 2
            homography, mask = cv2.findHomography(source, target, cv2.USAC_MAGSAC, ransac_threshold, maxIters=3000, confidence=.995)
            if homography is None or mask is None or not np.isfinite(homography).all():
                continue
            inliers = int(mask.sum())
            confidence = inliers / (8 + .3 * len(good))
            condition = _rotation_condition(homography, a.img_size, b.img_size)
            if inliers < 15 or inliers / len(good) < .2 or condition > 2.5:
                continue
            try:
                inverse = np.linalg.inv(homography)
            except np.linalg.LinAlgError:
                continue
            if not np.isfinite(inverse).all():
                continue
            graph[first].add(second)
            graph[second].add(first)
            alignment_points = _alignment_sample(good, mask, keypoints[first], a.img_size)
            forward, reverse = pairwise[first * count + second], pairwise[second * count + first]
            for match, src, dst, matrix, points in (
                (forward, first, second, homography, alignment_points),
                (reverse, second, first, inverse, [cv2.DMatch(m.trainIdx, m.queryIdx, m.distance) for m in alignment_points]),
            ):
                match.src_img_idx, match.dst_img_idx = src, dst
                # Confidence 1 was a heuristic filter, not a geometry test.
                # Keep verified lower-score links visible to native refinement.
                match.H, match.confidence, match.num_inliers = matrix, max(1.01, confidence), len(points)
                match.matches, match.inliers_mask = tuple(points), (1,) * len(points)
            reports.append({
                'pair': len(reports) + 1, 'from_index': first, 'to_index': second,
                'keypoints_base': len(keypoints[first]), 'keypoints_next': len(keypoints[second]),
                'candidate_matches': len(candidates), 'good_matches': len(good),
                'inliers': inliers, 'inlier_ratio': round(inliers / len(good), 4),
                'alignment_matches': len(alignment_points),
                'rotation_condition': round(condition, 4),
                'processing_ms': round((perf_counter() - pair_started) * 1000, 2),
            })
    components = []
    remaining = set(range(count))
    while remaining:
        first = min(remaining)
        reached, pending = {first}, [first]
        while pending:
            for neighbour in graph[pending.pop()] - reached:
                reached.add(neighbour)
                pending.append(neighbour)
        components.append(sorted(reached))
        remaining.difference_update(reached)
    return SphericalMatches(working, features, pairwise, reports, components)


def _copy_cameras(cameras):
    copies = []
    for camera in cameras:
        result = cv2.detail.CameraParams()
        result.focal, result.aspect = camera.focal, camera.aspect
        result.ppx, result.ppy = camera.ppx, camera.ppy
        result.R, result.t = camera.R.copy().astype(np.float32), camera.t.copy()
        copies.append(result)
    return copies


def _estimate_cameras(prepared, cameras=None):
    """Use full verified edge strength for the estimator's spanning tree.

    Bundle adjustment needs num_inliers to equal its bounded point sample.
    Initial estimation only uses that count as an edge weight; capping every
    strong edge at 200 otherwise lets weaker edges win arbitrary ties.
    """
    count = len(prepared.features)
    saved = []
    try:
        for report in prepared.reports:
            first, second = report['from_index'], report['to_index']
            for match in (prepared.pairwise[first * count + second], prepared.pairwise[second * count + first]):
                saved.append((match, match.num_inliers))
                match.num_inliers = report['inliers']
        return cv2.detail_HomographyBasedEstimator(cameras is not None).apply(prepared.features, prepared.pairwise, cameras)
    finally:
        for match, original in saved:
            match.num_inliers = original


def _alignment_quality(prepared, cameras):
    """Check fitted cameras against real inlier pixels, including every photo.

    A solver success flag alone does not establish a usable fit. Conversely,
    a few conflicting repeated-wall links must not defeat a connected set of
    geometrically consistent links. No camera/view is dropped by this check.
    """
    count = len(prepared.features)
    invalid = {"valid": False, "median_reprojection_error_px": None, "aligned_pairs": 0, "worst_photo_indices": list(range(min(count, 5)))}
    if len(cameras) != count or any(
        not np.isfinite(camera.focal) or not .15 * max(feature.img_size) <= camera.focal <= 8 * max(feature.img_size)
        or not np.isfinite(camera.R).all() or not np.isfinite(camera.K()).all()
        for camera, feature in zip(cameras, prepared.features)
    ):
        return invalid
    points = [np.array([point.pt for point in feature.keypoints], np.float64) for feature in prepared.features]
    graph = [set() for _ in range(count)]
    errors, per_photo = [], [[] for _ in range(count)]
    rejected = 0
    for report in prepared.reports:
        first, second = report['from_index'], report['to_index']
        match = prepared.pairwise[first * count + second]
        pairs = [point for point, valid in zip(match.getMatches(), match.getInliers()) if valid]
        if not pairs:
            continue
        source = points[first][[point.queryIdx for point in pairs]]
        target = points[second][[point.trainIdx for point in pairs]]
        transform = cameras[second].K() @ cameras[second].R.T @ cameras[first].R @ np.linalg.inv(cameras[first].K())
        projected = np.column_stack((source, np.ones(len(source)))) @ transform.T
        front = projected[:, 2] > 1e-6
        distances = np.full(len(source), np.inf)
        distances[front] = np.linalg.norm(projected[front, :2] / projected[front, 2, None] - target[front], axis=1)
        median = float(np.median(distances))
        tolerance = max(6., .015 * max(prepared.features[second].img_size))
        errors.append(median)
        per_photo[first].append(median)
        per_photo[second].append(median)
        if np.mean(front) >= .9 and median <= tolerance * 2:
            graph[first].add(second)
            graph[second].add(first)
        else:
            rejected += 1
    reached, pending = {0}, [0]
    while pending:
        for neighbour in graph[pending.pop()] - reached:
            reached.add(neighbour)
            pending.append(neighbour)
    median_error = float(np.median(errors)) if errors else np.inf
    tolerance = max(6., .015 * float(np.median([max(feature.img_size) for feature in prepared.features])))
    worst = sorted(range(count), key=lambda index: float(np.median(per_photo[index])) if per_photo[index] else np.inf, reverse=True)[:5]
    return {
        "valid": len(reached) == count and np.isfinite(median_error) and median_error <= tolerance,
        "median_reprojection_error_px": round(median_error, 2) if np.isfinite(median_error) else None,
        "aligned_pairs": len(errors) - rejected, "rejected_pairs": rejected,
        "worst_photo_indices": worst,
    }


def _refine_cameras(prepared, on_progress=None):
    """Recover a failed ray fit with constrained pixel reprojection.

    OpenCV's ray optimizer can step through negative focal lengths and produce
    NaNs. Recovery starts from untouched cameras, fixes aspect/principal point,
    and validates the new solution against observed image correspondences.
    """
    from .panorama_service import StitchingError

    features, pairwise = prepared.features, prepared.pairwise
    ok, initial = _estimate_cameras(prepared)
    if not ok:
        raise StitchingError('Camera positions could not be estimated from the shared photo detail.')
    for camera in initial:
        camera.R = camera.R.astype(np.float32)
    best_quality = None
    for method in ('ray', 'reprojection', 'rotation_only'):
        if on_progress:
            on_progress("Refining camera alignment" if method == 'ray' else "Recovering camera alignment" if method == 'reprojection' else "Stabilizing camera alignment")
        cameras = _copy_cameras(initial)
        if method == 'ray':
            adjuster = cv2.detail_BundleAdjusterRay()
            iterations = 100
        else:
            # Keep the image centre and square pixels fixed. If focal recovery
            # is itself unstable, the last bounded attempt refines rotations.
            scales = [camera.focal / max(feature.img_size) for camera, feature in zip(initial, features) if np.isfinite(camera.focal) and .25 <= camera.focal / max(feature.img_size) <= 4]
            focal_scale = float(np.median(scales)) if scales else .9
            for camera, feature in zip(cameras, features):
                camera.focal = focal_scale * max(feature.img_size)
                camera.aspect = 1.
                camera.ppx, camera.ppy = np.array(feature.img_size) / 2
                # The homography estimator multiplies double-precision
                # matrices; its root rotation must have the same type.
                camera.R = np.eye(3, dtype=np.float64)
            ok, cameras = _estimate_cameras(prepared, cameras)
            if not ok:
                continue
            for camera in cameras:
                camera.R = camera.R.astype(np.float32)
            adjuster = cv2.detail_BundleAdjusterReproj()
            mask = np.zeros((3, 3), np.uint8)
            mask[0, 0] = int(method == 'reprojection')
            adjuster.setRefinementMask(mask)
            iterations = 40
        adjuster.setConfThresh(1.0)
        adjuster.setTermCriteria((cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, iterations, 1e-5))
        try:
            ok, fitted = adjuster.apply(features, pairwise, cameras)
            if not ok:
                continue
            quality = _alignment_quality(prepared, fitted)
        except (cv2.error, np.linalg.LinAlgError):
            continue
        if best_quality is None or (quality['median_reprojection_error_px'] is not None and (best_quality['median_reprojection_error_px'] is None or quality['median_reprojection_error_px'] < best_quality['median_reprojection_error_px'])):
            best_quality = quality
        if quality['valid']:
            return fitted, {"alignment_method": method, "alignment_recovered": method != 'ray', **quality}
    if best_quality and best_quality['median_reprojection_error_px'] is not None:
        photos = ', '.join(str(index + 1) for index in best_quality['worst_photo_indices'])
        raise StitchingError(f'Photo alignment is inconsistent; the largest errors involve photos {photos}. Review those photos or add overlapping views, then retry with the saved set.')
    raise StitchingError('Camera alignment could not be stabilized. Your photos are still saved on this page. Check for zoom changes or movement between photos, then retry.')


def reconstruct_sphere(images, detector, norm, ratio_threshold, ransac_threshold, *, prepared: SphericalMatches | None = None, capture_views=None, on_progress: Callable[[str], None] | None = None):
    """Estimate camera rotations jointly, then feather onto a true 360 x 180 canvas.

    Working images are bounded to 1600px; output is 4096x2048. Unlike a planar
    mosaic, longitude wraps and uncaptured ceiling/floor pixels remain masked.
    """
    from .panorama_service import StitchingError

    started = perf_counter()
    if prepared is None:
        prepared = prepare_spherical_matches(images, detector, norm, ratio_threshold, ransac_threshold, on_progress=on_progress)
    working, features, pairwise, reports = prepared.working, prepared.features, prepared.pairwise, prepared.reports
    if len(prepared.components) != 1:
        groups = '; '.join(', '.join(str(index + 1) for index in group) for group in prepared.components)
        raise StitchingError(f'Images form disconnected overlap groups ({groups}). Add overlapping images between these groups.')

    try:
        if on_progress:
            on_progress("Estimating camera positions")
        cameras, alignment_report = _refine_cameras(prepared, on_progress)
        # Level using the surrounding ring only: ceiling/floor cameras must not
        # pull the horizon toward their tilted viewing directions. Labels guide
        # leveling, never fabricate camera poses or bypass matching.
        level_indices = [index for index, view in enumerate(capture_views or []) if view == 'around']
        if len(level_indices) >= 3:
            originals = [cameras[index].R.copy() for index in level_indices]
            corrected = cv2.detail.waveCorrect([rotation.copy() for rotation in originals], cv2.detail.WAVE_CORRECT_HORIZ)
            correction = corrected[0] @ originals[0].T
            rotations = [(correction @ camera.R).astype(np.float32) for camera in cameras]
        else:
            rotations = cv2.detail.waveCorrect([c.R for c in cameras], cv2.detail.WAVE_CORRECT_HORIZ)
        width, height = 4096, 2048
        accumulated = np.zeros((height, width, 3), np.float32)
        weights = np.zeros((height, width), np.float32)
        # Inverse-project the fixed canvas. OpenCV's spherical warpRoi can miss
        # the zenith for upward-facing cameras, even when it is inside a photo.
        # Pixel-centre rays cover both poles and the wrap seam without trusting
        # that ROI. Process strips to bound temporary memory for large sets.
        longitude = ((np.arange(width, dtype=np.float32) + .5) / width * 2 - 1) * np.pi
        sin_lon, cos_lon = np.sin(longitude)[None, :], np.cos(longitude)[None, :]
        for image_index, (image, camera, rotation) in enumerate(zip(working, cameras, rotations)):
            if on_progress:
                on_progress(f"Rendering photo {image_index + 1} of {len(working)}")
            intrinsic = camera.K().astype(np.float32)
            inverse = rotation.T
            image_height, image_width = image.shape[:2]
            for start in range(0, height, 128):
                end = min(start + 128, height)
                polar = (np.arange(start, end, dtype=np.float32)[:, None] + .5) / height * np.pi
                world_x, world_y, world_z = np.sin(polar) * sin_lon, -np.cos(polar), np.sin(polar) * cos_lon
                x = inverse[0, 0] * world_x + inverse[0, 1] * world_y + inverse[0, 2] * world_z
                y = inverse[1, 0] * world_x + inverse[1, 1] * world_y + inverse[1, 2] * world_z
                z = inverse[2, 0] * world_x + inverse[2, 1] * world_y + inverse[2, 2] * world_z
                front = z > 1e-6
                denominator = np.where(front, z, 1)
                map_x = (intrinsic[0, 0] * x / denominator + intrinsic[0, 2]).astype(np.float32)
                map_y = (intrinsic[1, 1] * y / denominator + intrinsic[1, 2]).astype(np.float32)
                valid = front & (map_x >= 0) & (map_x <= image_width - 1) & (map_y >= 0) & (map_y <= image_height - 1)
                if not np.any(valid):
                    continue
                edge = np.minimum(np.minimum(map_x, image_width - 1 - map_x), np.minimum(map_y, image_height - 1 - map_y))
                weight = np.where(valid, np.maximum(edge, 0) + 1, 0)
                map_x[~valid], map_y[~valid] = -1, -1
                warped = cv2.remap(image, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
                accumulated[start:end] += warped.astype(np.float32) * weight[:, :, None]
                weights[start:end] += weight
        panorama = np.clip(np.divide(accumulated, weights[:, :, None], out=accumulated, where=weights[:, :, None] > 0), 0, 255).astype(np.uint8)
        evidence = np.where(weights > 0, 255, 0).astype(np.uint8)
    except cv2.error as error:
        raise StitchingError('Spherical camera alignment failed. Retake overlapping images from one fixed position.') from error
    return panorama, evidence, reports, {
        **alignment_report,
        'working_max_dimension': 1600,
        'focal_lengths': [round(c.focal, 2) for c in cameras],
        'horizontal_coverage_ratio': round(float(np.count_nonzero(np.any(evidence > 0, axis=0))) / width, 6),
        'coverage_report': spherical_coverage(evidence),
        'camera_estimation_ms': round((perf_counter() - started) * 1000, 2),
    }


def spherical_coverage(evidence):
    """Evidence-only coverage of the top/bottom 30-degree caps and middle band."""
    cap = max(1, evidence.shape[0] // 6)
    ratio = lambda region: round(float(np.count_nonzero(region)) / region.size, 6)
    return {
        'top_coverage_ratio': ratio(evidence[:cap]),
        'bottom_coverage_ratio': ratio(evidence[-cap:]),
        'around_coverage_ratio': ratio(evidence[cap:-cap]),
        'missing_ratio': round(1.0 - ratio(evidence), 6),
    }
