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
                    # Large sets otherwise spend most of the invocation on
                    # approximate descriptor search. Geometry/inlier gates and
                    # the final all-camera reprojection validation are unchanged.
                    search = cv2.FlannBasedMatcher(dict(algorithm=1, trees=4), dict(checks=32 if count > 40 else 64))
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


def _camera_canvas_regions(camera, rotation, image_size, width, height):
    """Conservative spherical cap enclosing a photo, including poles and wrap.

    Every photo still undergoes exact per-pixel projection/visibility checks.
    This only skips canvas regions outside its maximum corner viewing angle.
    """
    image_width, image_height = image_size
    if not np.allclose(rotation.T @ rotation, np.eye(3), atol=1e-3):
        return [(0, width, 0, height)]
    intrinsic = camera.K()
    dx = max(abs(intrinsic[0, 2]), abs(image_width - 1 - intrinsic[0, 2])) / intrinsic[0, 0]
    dy = max(abs(intrinsic[1, 2]), abs(image_height - 1 - intrinsic[1, 2])) / intrinsic[1, 1]
    radius = min(np.pi / 2, np.arctan(np.hypot(dx, dy)) + .01)
    axis = np.asarray(rotation[:, 2], np.float64)
    axis /= np.linalg.norm(axis)
    polar = np.arccos(np.clip(-axis[1], -1, 1))
    top = max(0, int(np.floor((polar - radius) / np.pi * height - .5)) - 2)
    bottom = min(height, int(np.ceil((polar + radius) / np.pi * height - .5)) + 3)
    if radius >= min(polar, np.pi - polar):
        return [(0, width, top, bottom)]
    span = np.arcsin(np.clip(np.sin(radius) / np.sin(polar), -1, 1))
    longitude = np.arctan2(axis[0], axis[2])
    left = int(np.floor(((longitude - span) / np.pi + 1) / 2 * width - .5)) - 2
    right = int(np.ceil(((longitude + span) / np.pi + 1) / 2 * width - .5)) + 3
    if right - left >= width:
        return [(0, width, top, bottom)]
    if left < 0:
        return [(0, right, top, bottom), (width + left, width, top, bottom)]
    if right > width:
        return [(left, width, top, bottom), (0, right - width, top, bottom)]
    return [(left, right, top, bottom)]


def _seam_ownership(working, cameras, rotations, width=512, height=256, on_progress=None):
    """Find content-aware seams on a small spherical preview, one source/pixel.

    Process two canvases at a time so memory does not grow with the photo count.
    Horizontal wrap padding supplies seam context across the panorama boundary.
    """
    owner = np.full((height, width), -1, np.int16)
    mosaic = np.zeros((height, width, 3), np.float32)
    longitude = ((np.arange(width, dtype=np.float32) + .5) / width * 2 - 1) * np.pi
    polar = (np.arange(height, dtype=np.float32)[:, None] + .5) / height * np.pi
    wx, wy, wz = np.sin(polar) * np.sin(longitude)[None, :], -np.cos(polar), np.sin(polar) * np.cos(longitude)[None, :]
    finder = cv2.detail_GraphCutSeamFinder('COST_COLOR_GRAD')
    fallbacks = 0
    padding = max(8, width // 8)
    sources, source_masks = [], []
    for index, (image, camera, rotation) in enumerate(zip(working, cameras, rotations)):
        if on_progress:
            on_progress(f"Selecting sharp source regions for photo {index + 1} of {len(working)}")
        inverse, k = rotation.T, camera.K()
        x = inverse[0, 0] * wx + inverse[0, 1] * wy + inverse[0, 2] * wz
        y = inverse[1, 0] * wx + inverse[1, 1] * wy + inverse[1, 2] * wz
        z = inverse[2, 0] * wx + inverse[2, 1] * wy + inverse[2, 2] * wz
        denominator = np.where(z > 1e-6, z, 1)
        mx = (k[0, 0] * x / denominator + k[0, 2]).astype(np.float32)
        my = (k[1, 1] * y / denominator + k[1, 2]).astype(np.float32)
        valid = (z > 1e-6) & (mx >= 0) & (my >= 0) & (mx <= image.shape[1] - 1) & (my <= image.shape[0] - 1)
        mx[~valid], my[~valid] = -1, -1
        warped = cv2.remap(image, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT).astype(np.float32)
        sources.append(warped.astype(np.uint8))
        source_masks.append(valid.astype(np.uint8) * 255)
    gains = np.ones((len(working), 3), np.float32)
    if len(working) > 1:
        try:
            compensation = cv2.detail_ChannelsCompensator()
            compensation.feed([(0, 0)] * len(working), sources, source_masks)
            gains = np.clip(np.array([np.asarray(gain).reshape(-1)[:3] for gain in compensation.getMatGains()], np.float32), .5, 2.)
            if gains.shape != (len(working), 3) or not np.isfinite(gains).all():
                raise ValueError('Invalid exposure correction')
        except (cv2.error, ValueError):
            gains = np.ones((len(working), 3), np.float32)
            fallbacks += 1
    for index, (source, mask) in enumerate(zip(sources, source_masks)):
        valid = mask > 0
        warped = np.clip(source.astype(np.float32) * gains[index], 0, 255).astype(np.uint8).astype(np.float32)
        existing = owner >= 0
        take = valid & ~existing
        if np.count_nonzero(valid & existing) >= 32:
            masks = [cv2.UMat(np.pad((mask.astype(np.uint8) * 255), ((0, 0), (padding, padding)), mode='wrap')) for mask in (existing, valid)]
            pictures = [np.pad(picture, ((0, 0), (padding, padding), (0, 0)), mode='wrap') for picture in (mosaic, warped)]
            try:
                selected = finder.find(pictures, [(0, 0), (0, 0)], masks)
                second = (selected if selected is not None else masks)[1]
                second = second.get() if hasattr(second, 'get') else second
                take |= valid & (second[:, padding:-padding] > 0)
            except cv2.error:
                # Preserve an existing single source instead of reverting to
                # broad averaging if a particular seam cannot be optimized.
                fallbacks += 1
        owner[take] = index
        mosaic[take] = warped[take]
    return owner, fallbacks, gains


def _blend_source_seams(working, cameras, rotations, owner, evidence, gains, fallback, on_progress=None, *, bounded=True):
    """Blend low-frequency exposure across seams, retaining source detail."""
    height, width = evidence.shape
    # Five bands only blend across ~32 output pixels: too narrow for the
    # broad exposure differences on plain ceilings at 4096px. Scale the
    # low-frequency support with output size, leaving sharp detail in the
    # finest band. Crop support/grid must use the same pyramid depth.
    bands = max(3, min(8, int(np.ceil(np.log2(max(width, height) / 16)))))
    grid = 1 << bands
    context = 4 * grid
    blender = cv2.detail_MultiBandBlender()
    blender.setNumBands(bands)
    blender.prepare((0, 0, width, height))
    longitude = ((np.arange(width, dtype=np.float32) + .5) / width * 2 - 1) * np.pi
    polar = (np.arange(height, dtype=np.float32)[:, None] + .5) / height * np.pi
    sin_lon, cos_lon = np.sin(longitude)[None, :], np.cos(longitude)[None, :]
    sin_polar, cos_polar = np.sin(polar), np.cos(polar)
    for index, (image, camera, rotation) in enumerate(zip(working, cameras, rotations)):
        if on_progress:
            on_progress(f"Blending source seams for photo {index + 1} of {len(working)}")
        k, inverse = camera.K(), rotation.T
        for left, right, top, bottom in _camera_canvas_regions(camera, rotation, image.shape[1::-1], width, height):
            selected = (owner[top:bottom, left:right] == index).astype(np.uint8) * 255
            if not np.any(selected):
                continue
            selected = cv2.dilate(selected, np.ones((7, 7), np.uint8))
            if bounded:
                # Only this source's selected region contributes to the blend.
                # Retain four pyramid supports of context and align the crop
                # with the pyramid's global sampling grid.
                x0, y0, crop_width, crop_height = cv2.boundingRect(selected)
                crop_left = max(left, (left + x0 - context) // grid * grid)
                crop_top = max(top, (top + y0 - context) // grid * grid)
                crop_right = min(right, ((left + x0 + crop_width + context + grid - 1) // grid) * grid)
                crop_bottom = min(bottom, ((top + y0 + crop_height + context + grid - 1) // grid) * grid)
                selected = selected[crop_top - top:crop_bottom - top, crop_left - left:crop_right - left].copy()
                left, right, top, bottom = crop_left, crop_right, crop_top, crop_bottom
            wx, wy, wz = sin_polar[top:bottom] * sin_lon[:, left:right], -cos_polar[top:bottom], sin_polar[top:bottom] * cos_lon[:, left:right]
            x = inverse[0, 0] * wx + inverse[0, 1] * wy + inverse[0, 2] * wz
            y = inverse[1, 0] * wx + inverse[1, 1] * wy + inverse[1, 2] * wz
            z = inverse[2, 0] * wx + inverse[2, 1] * wy + inverse[2, 2] * wz
            denominator = np.where(z > 1e-6, z, 1)
            mx = (k[0, 0] * x / denominator + k[0, 2]).astype(np.float32)
            my = (k[1, 1] * y / denominator + k[1, 2]).astype(np.float32)
            valid = (z > 1e-6) & (mx >= 0) & (my >= 0) & (mx <= image.shape[1] - 1) & (my <= image.shape[0] - 1)
            selected[~valid] = 0
            mx[~valid], my[~valid] = -1, -1
            warped = cv2.remap(image, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
            corrected = np.clip(warped.astype(np.float32) * gains[index], 0, 255).astype(np.int16)
            blender.feed(corrected, selected, (left, top))
    blended, mask = blender.blend(None, None)
    result = fallback.copy()
    use = (mask > 0) & (evidence > 0)
    result[use] = np.clip(blended[use], 0, 255).astype(np.uint8)
    result[evidence == 0] = 0
    return result


def _render_spherical_photos(working, cameras, rotations, width=4096, height=2048, on_progress=None, *, bounded=True, seam_aware=False, report=None):
    if seam_aware:
        # Keep large-set memory bounded while selecting seams at twice the
        # former resolution. Do not upsample small diagnostic renders first.
        seam_width = min(1024, width)
        seam_height = max(1, round(height * seam_width / width))
        owner, seam_fallbacks, exposure_gains = _seam_ownership(working, cameras, rotations, seam_width, seam_height, on_progress=on_progress)
        owner = cv2.resize(owner, (width, height), interpolation=cv2.INTER_NEAREST)
        chosen = np.zeros((height, width, 3), np.uint8)
        chosen_valid = np.zeros((height, width), bool)
        fallback = np.zeros_like(chosen)
        best_weight = np.zeros((height, width), np.float32)
        fallback_owner = np.full((height, width), -1, np.int16)
        if report is not None:
            report.update(renderer_version='spherical-seams-v2', blending_method='graphcut_multiband', seam_resolution=[seam_width, seam_height], seam_fallbacks=seam_fallbacks, exposure_gains=exposure_gains.tolist())
    else:
        accumulated = np.zeros((height, width, 3), np.float32)
        weights = np.zeros((height, width), np.float32)
    longitude = ((np.arange(width, dtype=np.float32) + .5) / width * 2 - 1) * np.pi
    polar = (np.arange(height, dtype=np.float32)[:, None] + .5) / height * np.pi
    sin_lon, cos_lon = np.sin(longitude)[None, :], np.cos(longitude)[None, :]
    sin_polar, cos_polar = np.sin(polar), np.cos(polar)
    sampled = 0
    for image_index, (image, camera, rotation) in enumerate(zip(working, cameras, rotations)):
        if on_progress:
            on_progress(f"Rendering photo {image_index + 1} of {len(working)}")
        intrinsic, inverse = camera.K().astype(np.float32), rotation.T
        image_height, image_width = image.shape[:2]
        regions = _camera_canvas_regions(camera, rotation, (image_width, image_height), width, height) if bounded else [(0, width, 0, height)]
        for left, right, top, bottom in regions:
            for start in range(top, bottom, 128):
                end = min(start + 128, bottom)
                sampled += (end - start) * (right - left)
                world_x = sin_polar[start:end] * sin_lon[:, left:right]
                world_y = -cos_polar[start:end]
                world_z = sin_polar[start:end] * cos_lon[:, left:right]
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
                if seam_aware:
                    warped = np.clip(warped.astype(np.float32) * exposure_gains[image_index], 0, 255).astype(np.uint8)
                    # Each output pixel comes from one actual photograph.
                    # A full-resolution geometric fallback keeps valid boundary
                    # pixels that a coarse seam preview could not represent.
                    better = valid & (weight > best_weight[start:end, left:right])
                    fallback[start:end, left:right][better] = warped[better]
                    best_weight[start:end, left:right][better] = weight[better]
                    fallback_owner[start:end, left:right][better] = image_index
                    selected = valid & (owner[start:end, left:right] == image_index)
                    chosen[start:end, left:right][selected] = warped[selected]
                    chosen_valid[start:end, left:right] |= selected
                else:
                    accumulated[start:end, left:right] += warped.astype(np.float32) * weight[:, :, None]
                    weights[start:end, left:right] += weight
    if seam_aware:
        fallback[chosen_valid] = chosen[chosen_valid]
        evidence = np.where(best_weight > 0, 255, 0).astype(np.uint8)
        fallback_owner[chosen_valid] = owner[chosen_valid]
        try:
            result = _blend_source_seams(working, cameras, rotations, fallback_owner, evidence, exposure_gains, fallback, on_progress)
        except cv2.error:
            result = fallback
            if report is not None:
                report.update(blending_method='graphcut_single_source_fallback', multiband_failed=True)
        return result, evidence, sampled
    panorama = np.clip(np.divide(accumulated, weights[:, :, None], out=accumulated, where=weights[:, :, None] > 0), 0, 255).astype(np.uint8)
    return panorama, np.where(weights > 0, 255, 0).astype(np.uint8), sampled


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
        camera_estimation_ms = round((perf_counter() - started) * 1000, 2)
        render_started = perf_counter()
        width, height = 4096, 2048
        render_report = {}
        panorama, evidence, render_samples = _render_spherical_photos(working, cameras, rotations, width, height, on_progress, seam_aware=True, report=render_report)
    except cv2.error as error:
        raise StitchingError('Spherical camera alignment failed. Retake overlapping images from one fixed position.') from error
    return panorama, evidence, reports, {
        **alignment_report,
        **render_report,
        'working_max_dimension': 1600,
        'render_sample_count': render_samples,
        'render_full_sample_count': width * height * len(working),
        'focal_lengths': [round(c.focal, 2) for c in cameras],
        'horizontal_coverage_ratio': round(float(np.count_nonzero(np.any(evidence > 0, axis=0))) / width, 6),
        'coverage_report': spherical_coverage(evidence),
        'camera_estimation_ms': camera_estimation_ms,
        'rendering_ms': round((perf_counter() - render_started) * 1000, 2),
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
