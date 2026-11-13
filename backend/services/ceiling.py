"""Align a shared ceiling plane from measured pixels, with a fixed reference."""
from __future__ import annotations

import heapq

import cv2
import numpy as np


def project_points(matrix, points):
    projected = np.column_stack((points, np.ones(len(points)))) @ matrix.T
    return projected[:, :2] / projected[:, 2:3]


def fit_ceiling_plane(prepared, indices, anchor, cameras=None, rotations=None):
    """Map each supported source into the anchor photo's pixel coordinates.

    A rotation-only fit cannot describe translation against a nearby ceiling.
    Refit its verified correspondences to a shared plane. The reference photo
    stays fixed, so a complete ceiling moulding in it cannot split at a seam.
    No capture-order/label-derived camera pose is introduced.
    """
    allowed = set(indices)
    count = len(prepared.features)
    points = {i: np.array([p.pt for p in prepared.features[i].keypoints], np.float64) for i in allowed}
    graph = {i: [] for i in allowed}
    edges = []
    for report in prepared.reports:
        first, second = report['from_index'], report['to_index']
        if first not in allowed or second not in allowed:
            continue
        match = prepared.pairwise[first * count + second]
        pairs = [p for p, valid in zip(match.getMatches(), match.getInliers()) if valid]
        if len(pairs) < 12:
            continue
        source = points[first][[p.queryIdx for p in pairs]]
        target = points[second][[p.trainIdx for p in pairs]]
        if cameras is not None and rotations is not None:
            # Exclude wall/floor features from the ceiling-plane estimate.
            rays = np.column_stack((source, np.ones(len(source)))) @ np.linalg.inv(cameras[first].K()).T @ rotations[first].T
            keep = -rays[:, 1] / np.linalg.norm(rays, axis=1) > np.cos(np.deg2rad(66))
            source, target = source[keep], target[keep]
        if len(source) < 12:
            continue
        matrix, mask = cv2.findHomography(source, target, cv2.USAC_MAGSAC, 2.5, maxIters=3000, confidence=.999)
        if matrix is None or mask is None or not np.isfinite(matrix).all():
            continue
        keep = mask.ravel() > 0
        if np.count_nonzero(keep) < 12 or np.mean(keep) < .6:
            continue
        source, target = source[keep], target[keep]
        residual = float(np.median(np.linalg.norm(project_points(matrix, source) - target, axis=1)))
        if residual > 2 or np.linalg.det(matrix) <= 0:
            continue
        if cameras is not None and rotations is not None:
            rotation_fit = cameras[second].K() @ rotations[second].T @ rotations[first] @ np.linalg.inv(cameras[first].K())
            drift = np.median(np.linalg.norm(project_points(rotation_fit, source) - target, axis=1))
            if drift > .04 * max(prepared.features[second].img_size):
                continue
        try:
            inverse = np.linalg.inv(matrix)
        except np.linalg.LinAlgError:
            continue
        cost = (1 + residual) / np.sqrt(len(source))
        # At a known node, the matrix maps a neighbouring source INTO it.
        graph[second].append((first, matrix, cost))
        graph[first].append((second, inverse, cost))
        edges.append((first, second, source, target))
    def tree(jitter):
        transforms = {anchor: np.eye(3)}
        distances = {anchor: 0.}
        queue = [(0., anchor)]
        while queue:
            distance, current = heapq.heappop(queue)
            if distance != distances[current]:
                continue
            for neighbour, matrix, cost in graph[current]:
                candidate = distance + cost * jitter[positions[current], positions[neighbour]]
                if candidate >= distances.get(neighbour, np.inf):
                    continue
                composed = transforms[current] @ matrix
                if not np.isfinite(composed).all() or abs(composed[2, 2]) < 1e-8:
                    continue
                transforms[neighbour] = composed / composed[2, 2]
                distances[neighbour] = candidate
                heapq.heappush(queue, (candidate, neighbour))
        return transforms

    # Repeated rectangular trims can produce individually convincing false
    # edges. Select the graph solution with the strongest independent cycle
    # agreement, rather than trusting one greedy spanning tree.
    random = np.random.default_rng(42)
    positions = {index: position for position, index in enumerate(sorted(allowed))}
    best_score, transforms, consistent, connected = None, {}, [], set()
    for trial in range(192):
        jitter = np.ones((len(allowed), len(allowed))) if trial == 0 else np.exp(random.normal(0, 1.2, (len(allowed), len(allowed))))
        candidate = tree(jitter)
        accepted = []
        for first, second, source, target in edges:
            if first not in candidate or second not in candidate:
                continue
            predicted = project_points(np.linalg.inv(candidate[second]) @ candidate[first], source)
            error = float(np.median(np.linalg.norm(predicted - target, axis=1)))
            if error <= 5:
                accepted.append((first, second, error, len(source)))
        core = {anchor}
        while True:
            reached = core | {j for i, j, _, _ in accepted if i in core} | {i for i, j, _, _ in accepted if j in core}
            if reached == core:
                break
            core = reached
        # Count only independent cycle support. A high-count false match
        # must not beat a larger, more consistently aligned ceiling region.
        while True:
            degree = {i: sum(1 for a, b, _, _ in accepted if a in core and b in core and i in (a, b)) for i in core}
            remove = {i for i in core if i != anchor and degree[i] < 2}
            if not remove:
                break
            core -= remove
        supported = [edge for edge in accepted if edge[0] in core and edge[1] in core]
        residuals = [edge[2] for edge in supported]
        score = (len(core), len(supported), -float(np.median(residuals)) if residuals else -np.inf)
        if best_score is None or score > best_score:
            best_score, transforms, consistent, connected = score, candidate, supported, core
    transforms = {i: matrix for i, matrix in transforms.items() if i in connected}
    errors = [error for i, j, error, _ in consistent if i in connected and j in connected]
    quality = {
        'anchor_index': anchor, 'source_indices': sorted(transforms),
        'median_residual_px': round(float(np.median(errors)), 3) if errors else None,
        'p90_residual_px': round(float(np.percentile(errors, 90)), 3) if errors else None,
        'verified_pairs': len(errors), 'rejected_pairs': len(edges) - len(errors),
    }
    quality['valid'] = len(transforms) >= 3 and len(errors) >= len(transforms) and quality['median_residual_px'] <= 3 and quality['p90_residual_px'] <= 8
    return transforms, quality


def correct_ceiling(prepared, cameras, rotations, capture_views, panorama, evidence, on_progress=None):
    """Replace only the supported zenith cap using a verified ceiling plane."""
    indices = [i for i, view in enumerate(capture_views or [])
               if view == 'top' and -rotations[i][1, 2] >= .65]
    skipped = {'applied': False}
    if len(indices) < 3:
        return panorama, evidence, {**skipped, 'reason': 'Insufficient overhead views'}
    anchor = max(indices, key=lambda i: -rotations[i][1, 2])
    if -rotations[anchor][1, 2] < .85:
        return panorama, evidence, {**skipped, 'reason': 'No measured overhead reference'}
    if on_progress:
        on_progress('Aligning ceiling details to the overhead reference')
    transforms, quality = fit_ceiling_plane(prepared, indices, anchor, cameras, rotations)
    if not quality['valid']:
        return panorama, evidence, {**quality, **skipped, 'reason': 'Ceiling matches do not form a consistent plane'}
    # This is a local correction for parallax, not a replacement of an already
    # accurate rotation fit or a claim that every roof/sky is a flat surface.
    residuals = []
    count = len(prepared.features)
    for report in prepared.reports:
        i, j = report['from_index'], report['to_index']
        if i not in transforms or j not in transforms:
            continue
        match = prepared.pairwise[i * count + j]
        pairs = [p for p, valid in zip(match.getMatches(), match.getInliers()) if valid]
        source = np.array([prepared.features[i].keypoints[p.queryIdx].pt for p in pairs])
        target = np.array([prepared.features[j].keypoints[p.trainIdx].pt for p in pairs])
        if not len(source):
            continue
        matrix = cameras[j].K() @ rotations[j].T @ rotations[i] @ np.linalg.inv(cameras[i].K())
        residuals.append(float(np.median(np.linalg.norm(project_points(matrix, source) - target, axis=1))))
    rotation_error = float(np.median(residuals)) if residuals else 0.
    quality['rotation_residual_px'] = round(rotation_error, 3)
    if rotation_error <= 2 or quality['median_residual_px'] >= .75 * rotation_error:
        return panorama, evidence, {**quality, **skipped, 'reason': 'Rotation fit already agrees with the ceiling'}
    from .spherical import _render_spherical_photos
    selected = sorted(transforms)
    # A homography maps each source onto the reference plane. Combine its
    # inverse with the reference's MEASURED orientation to sample the sphere.
    projections = [
        (np.linalg.inv(cameras[i].K()) @ np.linalg.inv(transforms[i])
         @ cameras[anchor].K() @ rotations[anchor].T).T.astype(np.float32)
        for i in selected
    ]
    progress = (lambda stage: on_progress(f'Ceiling: {stage}')) if on_progress else None
    cap, cap_evidence, _ = _render_spherical_photos(
        [prepared.working[i] for i in selected], [cameras[i] for i in selected], projections,
        panorama.shape[1], panorama.shape[0], seam_aware=True, polar_limit=66, on_progress=progress,
        seam_mode="center", reference_index=selected.index(anchor),
    )
    core_bottom = max(1, round(evidence.shape[0] * 40 / 180))
    original_core = evidence[:core_bottom] > 0
    supported_core = (cap_evidence[:core_bottom] > 0) & original_core
    ratio = np.count_nonzero(supported_core) / max(1, np.count_nonzero(original_core))
    quality['cap_coverage_ratio'] = round(float(ratio), 4)
    if ratio < .95:
        return panorama, evidence, {**quality, **skipped, 'reason': 'Reference plane lacks ceiling coverage'}
    # All selected photos now share the reference plane's geometry.
    # Feather the cap only where both real-photo renders have evidence.
    polar = (np.arange(panorama.shape[0]) + .5) / panorama.shape[0] * 180
    alpha = np.clip((66 - polar) / 8, 0, 1)[:, None]
    alpha = alpha * alpha * (3 - 2 * alpha)
    alpha = np.broadcast_to(alpha, evidence.shape).copy()
    alpha[cap_evidence == 0] = 0
    alpha[(cap_evidence > 0) & (evidence == 0)] = 1
    result = panorama.copy()
    rows = np.flatnonzero(np.any(alpha > 0, axis=1))
    if len(rows):
        bottom = int(rows[-1]) + 1
        weight = alpha[:bottom, :, None]
        result[:bottom] = np.clip(cap[:bottom] * weight + panorama[:bottom] * (1 - weight), 0, 255).astype(np.uint8)
    combined = np.maximum(evidence, cap_evidence)
    return result, combined, {**quality, 'applied': True, 'method': 'verified_ceiling_plane', 'polar_limit_degrees': 66}
