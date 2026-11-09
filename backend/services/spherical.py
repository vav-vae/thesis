"""Bounded spherical reconstruction for photographs taken from one position."""
from __future__ import annotations

from dataclasses import dataclass
from time import perf_counter

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


def prepare_spherical_matches(images, detector, norm, ratio_threshold, ransac_threshold=4.0):
    """Match all source pairs at the resolution used for camera estimation.

    Reports contain accepted alignment edges only. Nonadjacent uploads can
    connect a set; absent edges are not individual image-quality failures.
    """
    working = []
    for image in images:
        height, width = image.shape[:2]
        scale = min(1.0, 1600 / max(height, width))
        working.append(cv2.resize(image, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA))
    features = [cv2.detail.computeImageFeatures2(detector, image) for image in working]
    for index, feature in enumerate(features):
        feature.img_idx = index
    count = len(features)
    descriptors = [feature.descriptors.get() for feature in features]
    # Estimator bindings require matcher-created MatchesInfo objects. Avoid
    # invoking the native matcher on absent/sparse descriptors; those images
    # cannot connect and reconstruction will reject the graph first.
    if count and all(descriptor is not None and len(descriptor) >= 2 for descriptor in descriptors):
        initial_matcher = cv2.detail_BestOf2NearestMatcher(False, .3)
        try:
            pairwise = list(initial_matcher.apply2(features))
        finally:
            initial_matcher.collectGarbage()
        for match in pairwise:
            match.confidence = 0.0
    else:
        pairwise = [cv2.detail.MatchesInfo() for _ in range(count * count)]
    graph = [set() for _ in features]
    reports = []
    matcher = cv2.BFMatcher(norm)
    for first in range(count):
        for second in range(first + 1, count):
            pair_started = perf_counter()
            a, b = features[first], features[second]
            first_descriptors, second_descriptors = descriptors[first], descriptors[second]
            if first_descriptors is None or second_descriptors is None:
                continue
            if len(first_descriptors) == 0 or len(second_descriptors) < 2:
                continue
            candidates = matcher.knnMatch(first_descriptors, second_descriptors, k=2)
            good = [pair[0] for pair in candidates if len(pair) == 2 and pair[0].distance < ratio_threshold * pair[1].distance]
            if len(good) < 10:
                continue
            source = np.float32([a.keypoints[m.queryIdx].pt for m in good]) - np.float32(a.img_size) / 2
            target = np.float32([b.keypoints[m.trainIdx].pt for m in good]) - np.float32(b.img_size) / 2
            homography, mask = cv2.findHomography(source, target, cv2.RANSAC, ransac_threshold)
            if homography is None or mask is None or not np.isfinite(homography).all():
                continue
            inliers = int(mask.sum())
            confidence = inliers / (8 + .3 * len(good))
            if inliers < 10 or inliers / len(good) < .25 or confidence < 1.0:
                continue
            try:
                inverse = np.linalg.inv(homography)
            except np.linalg.LinAlgError:
                continue
            if not np.isfinite(inverse).all():
                continue
            graph[first].add(second)
            graph[second].add(first)
            forward, reverse = pairwise[first * count + second], pairwise[second * count + first]
            for match, src, dst, matrix, points in (
                (forward, first, second, homography, good),
                (reverse, second, first, inverse, [cv2.DMatch(m.trainIdx, m.queryIdx, m.distance) for m in good]),
            ):
                match.src_img_idx, match.dst_img_idx = src, dst
                match.H, match.confidence, match.num_inliers = matrix, confidence, inliers
                match.matches, match.inliers_mask = tuple(points), tuple(int(value) for value in mask.ravel())
            reports.append({
                'pair': len(reports) + 1, 'from_index': first, 'to_index': second,
                'keypoints_base': len(a.keypoints), 'keypoints_next': len(b.keypoints),
                'candidate_matches': len(candidates), 'good_matches': len(good),
                'inliers': inliers, 'inlier_ratio': round(inliers / len(good), 4),
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


def reconstruct_sphere(images, detector, norm, ratio_threshold, ransac_threshold, *, prepared: SphericalMatches | None = None, capture_views=None):
    """Estimate camera rotations jointly, then feather onto a true 360 x 180 canvas.

    Working images are bounded to 1600px; output is 4096x2048. Unlike a planar
    mosaic, longitude wraps and uncaptured ceiling/floor pixels remain masked.
    """
    from .panorama_service import StitchingError

    started = perf_counter()
    if prepared is None:
        prepared = prepare_spherical_matches(images, detector, norm, ratio_threshold, ransac_threshold)
    working, features, pairwise, reports = prepared.working, prepared.features, prepared.pairwise, prepared.reports
    if len(prepared.components) != 1:
        groups = '; '.join(', '.join(str(index + 1) for index in group) for group in prepared.components)
        raise StitchingError(f'Images form disconnected overlap groups ({groups}). Add overlapping images between these groups.')

    try:
        ok, cameras = cv2.detail_HomographyBasedEstimator().apply(features, pairwise, None)
        if not ok:
            raise StitchingError('Camera estimation failed. Keep the camera at one position while rotating.')
        for camera in cameras:
            camera.R = camera.R.astype(np.float32)
        adjuster = cv2.detail_BundleAdjusterRay()
        adjuster.setConfThresh(1.0)
        adjuster.setTermCriteria((cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 100, 1e-6))
        ok, cameras = adjuster.apply(features, pairwise, cameras)
        if not ok:
            raise StitchingError('Camera alignment did not converge. Retake the sequence from one fixed position.')
        if any(not np.isfinite(c.focal) or c.focal <= 0 or not np.isfinite(c.R).all() for c in cameras):
            raise StitchingError('Camera alignment produced invalid geometry. Retake the sequence.')
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
        for image, camera, rotation in zip(working, cameras, rotations):
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
