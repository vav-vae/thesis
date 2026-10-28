"""Geometry regression checks using a reproducible, synthetic camera sweep."""
import unittest

import cv2
import numpy as np

from backend.services.panorama_service import (
    StitchingError, _detector_and_norm, analyze_image_sequence, reconstruct_hybrid_panorama,
)
from backend.services.spherical import reconstruct_sphere, spherical_coverage


def camera_sweep(include_poles=False):
    random = np.random.default_rng(42)
    texture = random.integers(30, 225, (1024, 2048, 3), dtype=np.uint8)
    texture = cv2.GaussianBlur(texture, (5, 5), 0)
    for _ in range(1500):
        x, y = random.integers(0, 2048), random.integers(160, 860)
        color = tuple(int(v) for v in random.integers(0, 255, 3))
        cv2.circle(texture, (int(x), int(y)), int(random.integers(3, 12)), color, -1)
    width, height = 960, 720
    focal = width / (2 * np.tan(np.deg2rad(100) / 2))
    x, y = np.meshgrid((np.arange(width) - width / 2) / focal, (np.arange(height) - height / 2) / focal)
    images = []
    views = [(yaw, 0) for yaw in range(0, 360, 60)]
    if include_poles:
        views += [(yaw, pitch) for pitch in (-60, 60) for yaw in (0, 120, 240)]
    for yaw, pitch in views:
        angle = np.deg2rad(yaw)
        tilt = np.deg2rad(pitch)
        tilted_y, tilted_z = np.cos(tilt) * y + np.sin(tilt), -np.sin(tilt) * y + np.cos(tilt)
        rotated_x, rotated_z = np.cos(angle) * x + np.sin(angle) * tilted_z, -np.sin(angle) * x + np.cos(angle) * tilted_z
        longitude = np.arctan2(rotated_x, rotated_z)
        latitude = np.arctan2(tilted_y, np.sqrt(rotated_x ** 2 + rotated_z ** 2))
        map_x = ((longitude + np.pi) / (2 * np.pi) * 2048).astype(np.float32)
        map_y = ((latitude + np.pi / 2) / np.pi * 1024).astype(np.float32)
        images.append(cv2.remap(texture, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP))
    return images


class SphericalTests(unittest.TestCase):
    def test_top_bottom_views_fill_both_poles_and_wrap_seam(self):
        cv2.setRNGSeed(42)
        images = camera_sweep(include_poles=True)
        views = ['around'] * 6 + ['top'] * 3 + ['bottom'] * 3
        # Interleave uploads: labels must remain associated with their photos.
        order = [6, 0, 9, 1, 7, 2, 10, 3, 8, 4, 11, 5]
        panorama, mask, metadata = reconstruct_hybrid_panorama(
            [images[index] for index in order], fill_gaps=False,
            capture_views=[views[index] for index in order],
        )
        self.assertEqual(panorama.shape, (2048, 4096, 3))
        self.assertFalse(np.any(mask))
        self.assertEqual(metadata['coverage_report'], {
            'top_coverage_ratio': 1.0, 'bottom_coverage_ratio': 1.0,
            'around_coverage_ratio': 1.0, 'missing_ratio': 0.0,
        })
        self.assertTrue(np.all(np.any(panorama > 0, axis=2)))
        self.assertFalse(metadata['unresolved_missing_regions'])

    def test_coverage_uses_evidence_not_image_brightness(self):
        evidence = np.zeros((60, 120), np.uint8)
        evidence[10:50] = 255
        self.assertEqual(spherical_coverage(evidence), {
            'top_coverage_ratio': 0.0, 'bottom_coverage_ratio': 0.0,
            'around_coverage_ratio': 1.0, 'missing_ratio': .333333,
        })

    def test_invalid_capture_views_and_oversized_sets_are_rejected(self):
        images = [np.zeros((480, 640, 3), np.uint8)] * 6
        for views in (['around'], ['unknown'] * 6):
            with self.assertRaisesRegex(StitchingError, 'capture view'):
                reconstruct_hybrid_panorama(images, capture_views=views)
        with self.assertRaisesRegex(StitchingError, '6 to 24'):
            reconstruct_hybrid_panorama(images * 5)

    def test_shuffled_sweep_passes_preflight_and_reconstruction(self):
        sweep = camera_sweep()
        images = [sweep[index] for index in [0, 2, 4, 1, 5, 3]]
        cv2.setRNGSeed(42)
        analysis = analyze_image_sequence(images)
        self.assertTrue(analysis['can_stitch'])
        self.assertEqual(analysis['overlap_graph']['components'], [list(range(6))])
        links = {(pair['from_index'], pair['to_index']) for pair in analysis['pairs']}
        self.assertNotIn((0, 1), links)  # Adjacent uploads are 120 degrees apart.
        self.assertIn((0, 3), links)  # Real overlap connects nonadjacent uploads.
        cv2.setRNGSeed(42)
        panorama, _, metadata = reconstruct_hybrid_panorama(images, fill_gaps=False)
        self.assertEqual(panorama.shape, (2048, 4096, 3))
        self.assertEqual(metadata['overlap_report'], analysis['pairs'])
        self.assertEqual(links, {
            (pair['from_index'], pair['to_index']) for pair in metadata['ransac_report']
        })

    def test_separate_overlapping_groups_remain_blocked(self):
        sweep = camera_sweep()
        cv2.setRNGSeed(42)
        analysis = analyze_image_sequence([sweep[index] for index in [0, 1, 3, 4]])
        self.assertFalse(analysis['can_stitch'])
        self.assertEqual(analysis['overlap_graph']['components'], [[0, 1], [2, 3]])
        self.assertEqual(analysis['issues'][0]['code'], 'overlap_disconnected')
        self.assertIn('[1, 2] / [3, 4]', analysis['issues'][0]['message'])

    def test_six_rotated_views_produce_bounded_spherical_output(self):
        cv2.setRNGSeed(42)
        panorama, mask, metadata = reconstruct_hybrid_panorama(camera_sweep(), fill_gaps=False)
        self.assertEqual(panorama.shape, (2048, 4096, 3))
        self.assertEqual(mask.shape, (2048, 4096))
        self.assertFalse(np.any(mask))
        self.assertEqual(metadata['projection'], 'equirectangular')
        self.assertTrue(metadata['spherical_projection'])
        self.assertGreater(metadata['camera_report']['horizontal_coverage_ratio'], .98)
        self.assertGreater(metadata['evidence_coverage_ratio'], .25)
        self.assertLess(metadata['evidence_coverage_ratio'], .8)
        self.assertLess(metadata['coverage_report']['top_coverage_ratio'], .01)
        self.assertLess(metadata['coverage_report']['bottom_coverage_ratio'], .01)
        self.assertTrue(metadata['unresolved_missing_regions'])
        self.assertFalse(metadata['ai_completion_used'])

    def test_disconnected_camera_graph_returns_retake_guidance(self):
        random = np.random.default_rng(90)
        images = [random.integers(0, 255, (480, 640, 3), dtype=np.uint8) for _ in range(6)]
        detector, norm, ratio = _detector_and_norm('orb')
        with self.assertRaisesRegex(StitchingError, 'disconnected overlap groups'):
            reconstruct_sphere(images, detector, norm, ratio, 4.0)


if __name__ == '__main__':
    unittest.main()
