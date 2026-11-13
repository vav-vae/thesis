import unittest
from unittest.mock import patch

import cv2
import numpy as np

from backend.services.panorama_service import StitchingError, _detector_and_norm
from backend.services.spherical import SphericalMatches, _native_pairwise, prepare_spherical_matches, reconstruct_sphere, subset_spherical_matches
from backend.tests.test_spherical import camera_sweep


class MatchingEfficiencyTests(unittest.TestCase):
    def test_opposing_caps_keep_the_same_verified_alignment_edges(self):
        poses = [(i * 360 / 14, 0) for i in range(14)]
        poses += [(i * 360 / 14, pitch) for pitch in (-60, 60) for i in range(14)]
        images = camera_sweep(poses=poses, width=320, height=240)
        views = ['around'] * 14 + ['bottom'] * 14 + ['top'] * 14
        detector, norm, ratio = _detector_and_norm('sift')
        cv2.setRNGSeed(42)
        baseline = prepare_spherical_matches(images, detector, norm, ratio, capture_views=views, full_search=True)
        cv2.setRNGSeed(42)
        count = len(images)
        reused = SphericalMatches(baseline.working, baseline.features, _native_pairwise(baseline.features), [], [],
                                  [(i, j) for i in range(count) for j in range(i + 1, count)])
        fast = prepare_spherical_matches([], detector, norm, ratio, prepared=reused, capture_views=views)
        self.assertEqual(fast.components, baseline.components)
        self.assertEqual({(p['from_index'], p['to_index']) for p in fast.reports},
                         {(p['from_index'], p['to_index']) for p in baseline.reports})
        self.assertGreater(fast.matching_stats['opposite_view_pairs_deferred'], 0)
        for report in baseline.reports:
            i, j = report['from_index'], report['to_index']
            np.testing.assert_array_equal(fast.pairwise[i * count + j].H, baseline.pairwise[i * count + j].H)

    def test_a_missed_bridge_expands_search_without_detecting_features_again(self):
        # Deliberately incorrect labels: the two cap groups are actually a
        # surrounding sweep. The conservative fallback must reconnect them.
        images = camera_sweep(poses=[(i * 360 / 42, 0) for i in range(42)], width=240, height=180)
        detector, norm, ratio = _detector_and_norm('sift')
        cv2.setRNGSeed(42)
        with patch('backend.services.spherical._probe_has_overlap', return_value=False), \
             patch('backend.services.spherical.cv2.detail.computeImageFeatures2', wraps=cv2.detail.computeImageFeatures2) as detect:
            result = prepare_spherical_matches(images, detector, norm, ratio, capture_views=['top'] * 21 + ['bottom'] * 21)
        self.assertEqual(detect.call_count, 42)
        self.assertEqual(result.components, [list(range(42))])
        self.assertTrue(result.matching_stats['expanded_full_search'])
        self.assertFalse(result.deferred_pairs)

    def test_unlabelled_uploads_use_the_complete_search(self):
        images = camera_sweep(width=240, height=180)
        result = prepare_spherical_matches(images, *_detector_and_norm('sift'))
        self.assertFalse(result.deferred_pairs)
        self.assertEqual(result.matching_stats['full_pairs_checked'], 15)

    def test_camera_failure_restores_deferred_pairs_before_retrying_the_fit(self):
        images = [np.full((240, 320, 3), 120, np.uint8)] * 6
        prepared = SphericalMatches(images, [], [], [], [list(range(6))], [(0, 1)])
        expanded = SphericalMatches(images, [], [], [], [list(range(6))])
        cameras = []
        for _ in images:
            camera = cv2.detail.CameraParams()
            camera.focal, camera.aspect, camera.ppx, camera.ppy = 200., 1., 160., 120.
            camera.R = np.eye(3, dtype=np.float32)
            cameras.append(camera)
        panorama = np.full((180, 360, 3), 120, np.uint8)
        evidence = np.full((180, 360), 255, np.uint8)
        with patch('backend.services.spherical._refine_cameras', side_effect=[StitchingError('Retry full graph'), (cameras, {'valid': True})]) as refine, \
             patch('backend.services.spherical.prepare_spherical_matches', return_value=expanded) as complete, \
             patch('backend.services.spherical._render_spherical_photos', return_value=(panorama, evidence, 0)), \
             patch('backend.services.spherical.cv2.detail.waveCorrect', side_effect=lambda values, _: values):
            result, _, _, _ = reconstruct_sphere(images, None, cv2.NORM_L2, .7, 4, prepared=prepared)
        self.assertIs(result, panorama)
        self.assertEqual(refine.call_count, 2)
        self.assertIs(complete.call_args.kwargs['prepared'], prepared)
        self.assertTrue(complete.call_args.kwargs['full_search'])

    def test_optional_disconnected_photo_only_expands_possible_bridges(self):
        poses = [(i * 360 / 14, 0) for i in range(14)]
        poses += [(i * 360 / 14, pitch) for pitch in (-60, 60) for i in range(14)]
        images = camera_sweep(poses=poses, width=240, height=180)
        noise = np.random.default_rng(9).integers(0, 255, (180, 240, 3), np.uint8)
        images.append(cv2.GaussianBlur(noise, (3, 3), 0))
        views = ['around'] * 14 + ['bottom'] * 14 + ['top'] * 15
        cv2.setRNGSeed(42)
        result = prepare_spherical_matches(images, *_detector_and_norm('sift'), capture_views=views)
        self.assertIn(list(range(42)), result.components)
        self.assertIn([42], result.components)
        self.assertGreater(result.matching_stats['connectivity_pairs_checked'], 0)
        self.assertLessEqual(result.matching_stats['connectivity_pairs_checked'], 14)
        self.assertGreater(len(result.deferred_pairs), 0)
        self.assertFalse(result.matching_stats['expanded_full_search'])
        subset = subset_spherical_matches(result, list(range(42)))
        self.assertTrue(subset.deferred_pairs)
        self.assertTrue(all(i < 42 and j < 42 for i, j in subset.deferred_pairs))


if __name__ == '__main__':
    unittest.main()
