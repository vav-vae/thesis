import unittest
from types import SimpleNamespace
from unittest.mock import patch

import cv2
import numpy as np

from backend.services.ceiling import correct_ceiling, fit_ceiling_plane, project_points


def ceiling_fixture(count=7, corrupt=False):
    x, y = np.meshgrid(np.linspace(60, 260, 8), np.linspace(50, 190, 6))
    plane = np.column_stack((x.ravel(), y.ravel()))
    transforms = [np.array([[1., 0., 2 * (i - count // 2)], [0., 1., 0], [0., 0., 1.]]) for i in range(count)]
    features = [SimpleNamespace(img_size=(320, 240), keypoints=[cv2.KeyPoint(float(x), float(y), 1) for x, y in project_points(np.linalg.inv(h), plane)]) for h in transforms]
    pairs, reports = [None] * (count * count), []
    bad_edges = {(0, 1), (0, 3), (1, 5), (2, 6), (4, 6)} if corrupt else set()
    for i in range(count):
        for j in range(i + 1, count):
            mapping = np.roll(np.arange(len(plane)).reshape(6, 8), 2, axis=1).ravel() if (i, j) in bad_edges else np.arange(len(plane))
            matches = [cv2.DMatch(k, int(target), 1.) for k, target in enumerate(mapping)]
            pairs[i * count + j] = SimpleNamespace(getMatches=lambda m=matches: m, getInliers=lambda: [1] * len(plane))
            reports.append({'from_index': i, 'to_index': j})
    prepared = SimpleNamespace(features=features, pairwise=pairs, reports=reports,
                               working=[np.full((240, 320, 3), 120, np.uint8) for _ in range(count)])
    return prepared, transforms, plane


class CeilingTests(unittest.TestCase):
    def test_repeated_trim_false_links_do_not_split_the_reference_plane(self):
        prepared, truth, points = ceiling_fixture(corrupt=True)
        transforms, quality = fit_ceiling_plane(prepared, list(range(7)), 0)
        self.assertTrue(quality['valid'], quality)
        self.assertGreaterEqual(quality['rejected_pairs'], 5)
        for index, matrix in transforms.items():
            source = project_points(np.linalg.inv(truth[index]), points)
            expected = project_points(np.linalg.inv(truth[0]), points)
            np.testing.assert_allclose(project_points(matrix, source), expected, atol=.01)

    def test_a_tree_without_independent_loop_evidence_is_not_accepted(self):
        prepared, _, _ = ceiling_fixture(3)
        prepared.reports = prepared.reports[:2]
        _, report = fit_ceiling_plane(prepared, [0, 1, 2], 0)
        self.assertFalse(report['valid'])

    def test_correction_keeps_walls_floor_and_original_panorama_unchanged(self):
        prepared, _, _ = ceiling_fixture(7)
        cameras = []
        for _ in range(7):
            camera = cv2.detail.CameraParams()
            camera.focal, camera.aspect, camera.ppx, camera.ppy = 200., 1., 160., 120.
            cameras.append(camera)
        rotations = [cv2.Rodrigues(np.float64([np.pi / 2, 0, 0]))[0].astype(np.float32)] * 7
        original = np.full((180, 360, 3), 40, np.uint8)
        evidence = np.full((180, 360), 255, np.uint8)
        cap = np.full_like(original, 120)
        cap_evidence = np.zeros_like(evidence)
        cap_evidence[:66] = 255
        with patch('backend.services.spherical._render_spherical_photos', return_value=(cap, cap_evidence, 0)) as render:
            result, covered, report = correct_ceiling(prepared, cameras, rotations, ['top'] * 7, original, evidence)
        self.assertTrue(report['applied'], report)
        self.assertEqual(render.call_args.kwargs['polar_limit'], 66)
        self.assertTrue(np.all(result[:58] == 120))
        np.testing.assert_array_equal(result[66:], original[66:])
        self.assertTrue(np.all(original == 40))
        np.testing.assert_array_equal(covered, evidence)

    def test_no_overhead_photos_leave_existing_render_unchanged(self):
        prepared, _, _ = ceiling_fixture(3)
        original = np.full((60, 120, 3), 90, np.uint8)
        evidence = np.full((60, 120), 255, np.uint8)
        result, covered, report = correct_ceiling(prepared, [], [], None, original, evidence)
        self.assertIs(result, original)
        self.assertIs(covered, evidence)
        self.assertFalse(report['applied'])

    def test_incomplete_plane_coverage_keeps_the_original_ceiling(self):
        prepared, _, _ = ceiling_fixture(7)
        cameras = []
        for _ in range(7):
            camera = cv2.detail.CameraParams()
            camera.focal, camera.aspect, camera.ppx, camera.ppy = 200., 1., 160., 120.
            cameras.append(camera)
        rotations = [cv2.Rodrigues(np.float64([np.pi / 2, 0, 0]))[0].astype(np.float32)] * 7
        original = np.full((180, 360, 3), 90, np.uint8)
        evidence = np.full((180, 360), 255, np.uint8)
        with patch('backend.services.spherical._render_spherical_photos', return_value=(np.zeros_like(original), np.zeros_like(evidence), 0)):
            result, covered, report = correct_ceiling(prepared, cameras, rotations, ['top'] * 7, original, evidence)
        self.assertIs(result, original)
        self.assertIs(covered, evidence)
        self.assertFalse(report['applied'])
        self.assertEqual(report['cap_coverage_ratio'], 0)


if __name__ == '__main__':
    unittest.main()
