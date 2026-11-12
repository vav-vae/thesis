import unittest
import cv2
import numpy as np
from backend.services.spherical import _render_spherical_photos, prepare_spherical_matches
from backend.services.panorama_service import _detector_and_norm
from backend.tests.test_spherical import camera_sweep


class SphericalRenderTests(unittest.TestCase):
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
