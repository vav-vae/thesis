import unittest
from unittest.mock import patch
import cv2
import numpy as np
from backend.services.spherical import _blend_source_seams, _render_spherical_photos, prepare_spherical_matches
from backend.services.panorama_service import _detector_and_norm
from backend.tests.test_spherical import camera_sweep


class SphericalRenderTests(unittest.TestCase):
    def test_uniform_ceiling_does_not_acquire_black_padding_halos(self):
        camera = cv2.detail.CameraParams()
        camera.focal, camera.aspect, camera.ppx, camera.ppy = 70., 1., 80., 60.
        images = [np.full((120, 160, 3), 180, np.uint8)] * 3
        rotations = [cv2.Rodrigues(np.float64([np.pi / 2, 0, yaw]))[0].astype(np.float32) for yaw in (-.4, 0, .4)]
        result, evidence, _ = _render_spherical_photos(images, [camera] * 3, rotations, 720, 360, seam_aware=True)
        interior = cv2.erode(evidence, np.ones((5, 5), np.uint8)) > 0
        self.assertLessEqual(int(np.abs(result[interior].astype(np.int16) - 180).max()), 10)
        self.assertFalse(np.any(result[evidence == 0]))

    def test_ceiling_cap_does_not_render_any_wall_or_floor_rows(self):
        camera = cv2.detail.CameraParams()
        camera.focal, camera.aspect, camera.ppx, camera.ppy = 40., 1., 60., 45.
        rotation = cv2.Rodrigues(np.float64([np.pi / 2, 0, 0]))[0].astype(np.float32)
        source = np.full((90, 120, 3), 180, np.uint8)
        result, evidence, _ = _render_spherical_photos([source], [camera], [rotation],
                                                      720, 360, seam_aware=True, polar_limit=66)
        self.assertTrue(np.any(evidence[:132]))
        self.assertFalse(np.any(evidence[132:]))
        self.assertFalse(np.any(result[132:]))

    def test_plain_ceiling_exposure_transition_is_not_a_narrow_bright_patch(self):
        camera = cv2.detail.CameraParams()
        camera.focal, camera.aspect, camera.ppx, camera.ppy = 160., 1., 160., 120.
        images = [np.full((240, 320, 3), value, np.uint8) for value in (100, 160)]
        rotations = [np.eye(3, dtype=np.float32)] * 2
        _, evidence, _ = _render_spherical_photos(images, [camera] * 2, rotations, 1536, 768)
        owner = np.zeros(evidence.shape, np.int16)
        owner[:, 768:] = 1
        owner[evidence == 0] = -1
        result = _blend_source_seams(images, [camera] * 2, rotations, owner, evidence,
                                     np.ones((2, 3)), np.zeros((768, 1536, 3), np.uint8))
        # Same geometry, different camera exposure. A five-band blend leaves
        # most of the 60-level change in this narrow strip on a plain ceiling.
        self.assertLess(int(result[384, 800, 0]) - int(result[384, 736, 0]), 25)
        self.assertTrue(np.all(result[evidence == 0] == 0))

    def test_seam_preview_scales_to_the_output_and_reports_its_real_size(self):
        camera = cv2.detail.CameraParams()
        camera.focal, camera.aspect, camera.ppx, camera.ppy = 80., 1., 60., 45.
        source = np.full((90, 120, 3), 150, np.uint8)
        report = {}
        _render_spherical_photos([source], [camera], [np.eye(3, dtype=np.float32)],
                                 1200, 600, seam_aware=True, report=report)
        self.assertEqual(report['seam_resolution'], [1024, 512])
        self.assertEqual(report['renderer_version'], 'spherical-ceiling-v3')

    def test_cropped_blending_preserves_full_region_output(self):
        random = np.random.default_rng(7)
        images = [random.integers(10, 245, (240, 320, 3), np.uint8) for _ in range(3)]
        camera = cv2.detail.CameraParams()
        camera.focal, camera.aspect, camera.ppx, camera.ppy = 180., 1., 160., 120.
        rotations = [cv2.Rodrigues(np.float64([0, yaw, 0]))[0].astype(np.float32) for yaw in (-.4, 0, .4)]
        arguments = (images, [camera] * 3, rotations, 1536, 768)
        reference_blend = lambda *args, **kwargs: _blend_source_seams(*args, **kwargs, bounded=False)
        with patch('backend.services.spherical._blend_source_seams', side_effect=reference_blend):
            reference, reference_evidence, _ = _render_spherical_photos(*arguments, seam_aware=True)
        cropped, evidence, _ = _render_spherical_photos(*arguments, seam_aware=True)
        np.testing.assert_array_equal(evidence, reference_evidence)
        difference = np.abs(cropped.astype(np.int16) - reference.astype(np.int16))
        self.assertLessEqual(int(difference.max()), 1)

    def test_multiband_failure_keeps_real_source_pixels_and_reports_fallback(self):
        camera = cv2.detail.CameraParams()
        camera.focal, camera.aspect, camera.ppx, camera.ppy = 80., 1., 60., 45.
        source = np.full((90, 120, 3), 180, np.uint8)
        report = {}
        with patch('backend.services.spherical._blend_source_seams', side_effect=cv2.error('Simulated blend failure')):
            result, evidence, _ = _render_spherical_photos([source], [camera], [np.eye(3, dtype=np.float32)], 360, 180, seam_aware=True, report=report)
        self.assertTrue(np.all(result[evidence > 0] == 180))
        self.assertTrue(report['multiband_failed'])
        self.assertEqual(report['blending_method'], 'graphcut_single_source_fallback')

    def test_seam_render_does_not_average_disagreeing_sources_or_lose_coverage(self):
        camera = cv2.detail.CameraParams()
        camera.focal, camera.aspect, camera.ppx, camera.ppy = 80., 1., 60., 45.
        rotation = np.eye(3, dtype=np.float32)
        first = np.full((90, 120, 3), (220, 40, 40), np.uint8)
        second = np.full_like(first, (40, 40, 220))
        report = {}
        selected, evidence, _ = _render_spherical_photos([first, second], [camera, camera], [rotation, rotation], 720, 360, seam_aware=True, report=report)
        _, reference, _ = _render_spherical_photos([first, second], [camera, camera], [rotation, rotation], 720, 360)
        np.testing.assert_array_equal(evidence, reference)
        interior = cv2.erode(evidence, np.ones((15, 15), np.uint8)) > 0
        colors = selected[interior].astype(np.int16)
        corrected_sources = np.clip(np.array([[220, 40, 40], [40, 40, 220]]) * np.array(report['exposure_gains']), 0, 255).astype(np.int16)
        distances = np.min(np.max(np.abs(colors[:, None, :] - corrected_sources[None, :, :]), axis=2), axis=1)
        # A broad average would sit midway between these very different colors.
        # Allow small pyramid reconstruction/rounding differences at the seam.
        self.assertLessEqual(float(distances.max()), 10)
        self.assertEqual(report['blending_method'], 'graphcut_multiband')
        self.assertEqual(report['seam_fallbacks'], 0)

    def test_large_capture_search_retains_a_connected_camera_sweep(self):
        cv2.setRNGSeed(42)
        images = camera_sweep(poses=[(index * 360 / 44, 0) for index in range(44)], width=240, height=180)
        prepared = prepare_spherical_matches(images, *_detector_and_norm('sift'))
        self.assertEqual(prepared.components, [list(range(44))])

    def test_bounded_render_matches_full_canvas_at_poles_wrap_and_random_poses(self):
        random = np.random.default_rng(13)
        images, cameras, rotations = [], [], []
        poses = [(0, 0), (180, 0), (179, 30), (-179, -30), (0, 90), (0, -90)]
        poses += list(zip(random.uniform(-180, 180, 12), random.uniform(-85, 85, 12)))
        for index, (yaw, pitch) in enumerate(poses):
            image = random.integers(1, 255, (90, 120, 3), dtype=np.uint8)
            camera = cv2.detail.CameraParams()
            camera.focal = (45, 80, 160)[index % 3]
            camera.aspect = 1.0
            camera.ppx, camera.ppy = 60., 45.
            y, p = np.deg2rad([yaw, pitch])
            ry = cv2.Rodrigues(np.array([0., y, 0.]))[0]
            rx = cv2.Rodrigues(np.array([p, 0., 0.]))[0]
            rotations.append((ry @ rx).astype(np.float32))
            cameras.append(camera)
            images.append(image)
        bounded, evidence, samples = _render_spherical_photos(images, cameras, rotations, 720, 360)
        reference, full_evidence, full_samples = _render_spherical_photos(images, cameras, rotations, 720, 360, bounded=False)
        np.testing.assert_array_equal(evidence, full_evidence)
        np.testing.assert_array_equal(bounded, reference)
        self.assertLess(samples, full_samples * .5)

    def test_invalid_rotation_uses_full_canvas_without_dropping_pixels(self):
        image = np.full((60, 80, 3), 120, dtype=np.uint8)
        camera = cv2.detail.CameraParams()
        camera.focal, camera.aspect, camera.ppx, camera.ppy = 80., 1., 40., 30.
        rotation = np.diag([1.01, 1., 1.]).astype(np.float32)
        _, evidence, samples = _render_spherical_photos([image], [camera], [rotation], 360, 180)
        _, reference, full_samples = _render_spherical_photos([image], [camera], [rotation], 360, 180, bounded=False)
        np.testing.assert_array_equal(evidence, reference)
        self.assertEqual(samples, full_samples)
