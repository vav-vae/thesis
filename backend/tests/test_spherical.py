"""Geometry regression checks using a reproducible, synthetic camera sweep."""
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import cv2
import numpy as np

from backend.services.panorama_service import (
    StitchingError, _detector_and_norm, analyze_image_sequence, reconstruct_hybrid_panorama,
)
from backend.services.spherical import _alignment_quality, _refine_cameras, _rotation_condition, prepare_spherical_matches, reconstruct_sphere, spherical_coverage


def camera_sweep(include_poles=False, *, poses=None, width=960, height=720):
    random = np.random.default_rng(42)
    texture = random.integers(30, 225, (1024, 2048, 3), dtype=np.uint8)
    texture = cv2.GaussianBlur(texture, (5, 5), 0)
    for _ in range(1500):
        x, y = random.integers(0, 2048), random.integers(160, 860)
        color = tuple(int(v) for v in random.integers(0, 255, 3))
        cv2.circle(texture, (int(x), int(y)), int(random.integers(3, 12)), color, -1)
    focal = width / (2 * np.tan(np.deg2rad(100) / 2))
    x, y = np.meshgrid((np.arange(width) - width / 2) / focal, (np.arange(height) - height / 2) / focal)
    images = []
    views = [(yaw, 0) for yaw in range(0, 360, 60)]
    if include_poles:
        views += [(yaw, pitch) for pitch in (-60, 60) for yaw in (0, 120, 240)]
    if poses is not None:
        views = poses
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
    def test_low_contrast_ceiling_views_remain_connected_to_the_room(self):
        images = camera_sweep(include_poles=True)
        # Preserve actual image detail while reducing its contrast, as on a
        # plain ceiling. SIFT must recover these pixels, not fabricate poses.
        images[6:] = [np.clip((image.astype(np.float32) - 128) * .2 + 128, 0, 255).astype(np.uint8) for image in images[6:]]
        cv2.setRNGSeed(42)
        prepared = prepare_spherical_matches(images, *_detector_and_norm('sift'))
        self.assertEqual(prepared.components, [list(range(12))])
        self.assertTrue(all(any(index in (pair['from_index'], pair['to_index']) for pair in prepared.reports) for index in range(6, 12)))

    def test_collapsed_and_reflected_homographies_are_not_camera_rotations(self):
        collapsed = np.array([[1., 0., 100.], [0., 1e-6, 20.], [0., 0., 1.]])
        reflected = np.diag([-1., 1., 1.])
        self.assertGreater(_rotation_condition(collapsed, (1600, 1200), (1600, 1200)), 2.5)
        self.assertGreater(_rotation_condition(reflected, (1600, 1200), (1600, 1200)), 2.5)
        rotation = cv2.Rodrigues(np.array([.1, .4, -.1]))[0]
        intrinsic = np.diag([1280., 1280., 1.])
        physical = intrinsic @ rotation @ np.linalg.inv(intrinsic)
        self.assertLess(_rotation_condition(physical, (1600, 1200), (1600, 1200)), 2.5)

    @unittest.skipUnless(Path('test image/new_test/capture-around-12-1794031489124.jpg').exists(), 'Private live-capture fixture is local only')
    def test_real_live_capture_low_confidence_overlap_is_not_rejected(self):
        sources = [cv2.imread(str(path)) for path in sorted(Path('test image/new_test').glob('capture-around-1[23]-*.jpg'))]
        self.assertEqual(len(sources), 2)
        cv2.setRNGSeed(42)
        analysis = analyze_image_sequence(sources)
        self.assertTrue(analysis['can_stitch'], analysis)
        self.assertGreaterEqual(analysis['pairs'][0]['inliers'], 15)

    def test_failed_ray_solver_recovers_with_real_pixel_reprojection(self):
        failed = Mock()
        failed.apply.return_value = (False, None)
        cv2.setRNGSeed(42)
        with patch('backend.services.spherical.cv2.detail_BundleAdjusterRay', return_value=failed):
            panorama, _, metadata = reconstruct_hybrid_panorama(camera_sweep(), fill_gaps=False)
        report = metadata['camera_report']
        self.assertEqual(panorama.shape, (2048, 4096, 3))
        self.assertEqual(report['alignment_method'], 'reprojection')
        self.assertTrue(report['alignment_recovered'])
        self.assertLess(report['median_reprojection_error_px'], 2)
        self.assertEqual(metadata['used_image_indices'], list(range(6)))

    def test_nonfinite_ray_result_also_recovers_from_untouched_cameras(self):
        cv2.setRNGSeed(42)
        prepared = prepare_spherical_matches(camera_sweep(), *_detector_and_norm('sift'))
        _, bad = cv2.detail_HomographyBasedEstimator().apply(prepared.features, prepared.pairwise, None)
        bad[0].focal = float('nan')
        invalid_solver = Mock()
        invalid_solver.apply.return_value = (True, bad)
        with patch('backend.services.spherical.cv2.detail_BundleAdjusterRay', return_value=invalid_solver):
            cameras, report = _refine_cameras(prepared)
        self.assertTrue(all(np.isfinite(camera.focal) for camera in cameras))
        self.assertTrue(report['alignment_recovered'])
        self.assertTrue(report['valid'])

    def test_finite_but_wrong_camera_geometry_is_not_accepted(self):
        prepared = prepare_spherical_matches(camera_sweep(), *_detector_and_norm('sift'))
        _, cameras = cv2.detail_HomographyBasedEstimator().apply(prepared.features, prepared.pairwise, None)
        for camera in cameras:
            camera.R = np.eye(3, dtype=np.float32)
        self.assertFalse(_alignment_quality(prepared, cameras)['valid'])

    def test_exhausted_solvers_never_render_invalid_cameras(self):
        prepared = prepare_spherical_matches(camera_sweep(), *_detector_and_norm('sift'))
        failed = Mock()
        failed.apply.return_value = (False, None)
        with (
            patch('backend.services.spherical.cv2.detail_BundleAdjusterRay', return_value=failed),
            patch('backend.services.spherical.cv2.detail_BundleAdjusterReproj', return_value=failed),
            self.assertRaisesRegex(StitchingError, 'could not be stabilized.*still saved on this page'),
        ):
            _refine_cameras(prepared)

    def test_forty_distinct_photos_generate_without_dropping_views(self):
        poses = [(index * 22.5, 0) for index in range(16)]
        poses += [(index * 30, pitch) for pitch in (-60, 60) for index in range(12)]
        cv2.setRNGSeed(42)
        panorama, _, metadata = reconstruct_hybrid_panorama(
            camera_sweep(poses=poses), fill_gaps=False,
            capture_views=['around'] * 16 + ['top'] * 12 + ['bottom'] * 12,
        )
        self.assertEqual(panorama.shape, (2048, 4096, 3))
        self.assertEqual(metadata['image_count'], 40)
        self.assertEqual(metadata['used_image_indices'], list(range(40)))
        self.assertEqual(metadata['excluded_image_indices'], [])
        self.assertLess(metadata['coverage_report']['missing_ratio'], .01)
        self.assertTrue(all(pair['alignment_matches'] <= 200 for pair in metadata['ransac_report']))

    def test_blank_optional_views_do_not_block_a_real_connected_room(self):
        images = camera_sweep()
        blank = np.full_like(images[0], 180)
        # Interleaved optional views exercise report index mapping as well.
        sources = [blank, images[0], images[1], images[2], blank.copy(), images[3], images[4], images[5]]
        views = ['top', 'around', 'around', 'around', 'bottom', 'around', 'around', 'around']
        cv2.setRNGSeed(42)
        analysis = analyze_image_sequence(sources, capture_views=views)
        self.assertTrue(analysis['can_stitch'])
        self.assertEqual(analysis['excluded_image_indices'], [0, 4])
        self.assertEqual(analysis['used_image_indices'], [1, 2, 3, 5, 6, 7])
        self.assertFalse(any(issue['severity'] == 'error' for issue in analysis['issues']))
        cv2.setRNGSeed(42)
        panorama, _, metadata = reconstruct_hybrid_panorama(sources, capture_views=views, fill_gaps=False)
        self.assertEqual(panorama.shape, (2048, 4096, 3))
        self.assertEqual(metadata['image_count'], 6)
        self.assertEqual(metadata['input_image_count'], 8)
        self.assertEqual(metadata['excluded_image_indices'], [0, 4])
        self.assertIn('Used 6 of 8 photos', metadata['disclosure_message'])
        self.assertLess(metadata['coverage_report']['top_coverage_ratio'], .01)
        self.assertLess(metadata['coverage_report']['bottom_coverage_ratio'], .01)
        self.assertTrue(all(pair['from_index'] not in {0, 4} and pair['to_index'] not in {0, 4} for pair in metadata['ransac_report']))

    def test_disconnected_surrounding_photos_are_never_silently_discarded(self):
        images = camera_sweep()
        sources = images + [np.full_like(images[0], 180)]
        analysis = analyze_image_sequence(sources, capture_views=['around'] * 7)
        self.assertFalse(analysis['can_stitch'])
        self.assertEqual(analysis['excluded_image_indices'], [])
        with self.assertRaisesRegex(StitchingError, 'overlap'):
            reconstruct_hybrid_panorama(sources, capture_views=['around'] * 7)

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

    def test_invalid_capture_views_and_sets_below_minimum_are_rejected(self):
        images = [np.zeros((480, 640, 3), np.uint8)] * 6
        for views in (['around'], ['unknown'] * 6):
            with self.assertRaisesRegex(StitchingError, 'capture view'):
                reconstruct_hybrid_panorama(images, capture_views=views)
        with self.assertRaisesRegex(StitchingError, 'at least 6'):
            reconstruct_hybrid_panorama(images[:5])

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
