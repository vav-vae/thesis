import unittest
from unittest.mock import patch

import cv2
import numpy as np

try:
    from backend.services import panorama_service as service
    from backend.services.panorama_service import analyze_image_sequence, placeholder_ai_gap_fill
except ImportError:
    from services import panorama_service as service
    from services.panorama_service import analyze_image_sequence, placeholder_ai_gap_fill


def textured_image(seed: int = 7) -> np.ndarray:
    random = np.random.default_rng(seed)
    image = np.full((720, 1280, 3), 150, dtype=np.uint8)
    for _ in range(180):
        x, y = random.integers(20, 1260), random.integers(20, 700)
        color = tuple(int(value) for value in random.integers(20, 235, size=3))
        cv2.circle(image, (int(x), int(y)), int(random.integers(3, 12)), color, -1)
    cv2.putText(image, "LiBot room features", (180, 360), cv2.FONT_HERSHEY_SIMPLEX, 2, (20, 20, 20), 5)
    return image


class ImageAnalysisTests(unittest.TestCase):
    def test_sharp_overlapping_sequence_can_stitch(self):
        first = textured_image()
        second = np.roll(first, 80, axis=1)
        result = analyze_image_sequence([first, second], ["first.jpg", "second.jpg"], "orb")

        self.assertTrue(result["can_stitch"])
        self.assertGreater(result["images"][0]["keypoints"], 120)
        self.assertGreaterEqual(result["pairs"][0]["good_matches"], 25)

    def test_blurred_flat_images_are_blocked(self):
        flat = np.full((720, 1280, 3), 110, dtype=np.uint8)
        blurred = cv2.GaussianBlur(flat, (31, 31), 0)
        result = analyze_image_sequence([blurred, blurred.copy()], algorithm="orb")

        codes = {issue["code"] for image in result["images"] for issue in image["issues"]}
        self.assertFalse(result["can_stitch"])
        self.assertIn("blur_severe", codes)
        self.assertIn("features_insufficient", codes)

    def test_unrelated_images_fail_overlap(self):
        unrelated = np.random.default_rng(99).integers(0, 256, (720, 1280, 3), dtype=np.uint8)
        result = analyze_image_sequence([textured_image(1), unrelated], algorithm="orb")
        graph_codes = {issue["code"] for issue in result["issues"]}

        self.assertFalse(result["can_stitch"])
        self.assertIn("overlap_disconnected", graph_codes)
        self.assertEqual(result["overlap_graph"]["components"], [[0], [1]])
        self.assertEqual(result["pairs"], [])

    def test_portrait_image_is_rejected(self):
        portrait = cv2.rotate(textured_image(), cv2.ROTATE_90_CLOCKWISE)
        result = analyze_image_sequence([portrait, portrait.copy()], algorithm="orb")
        codes = {issue["code"] for image in result["images"] for issue in image["issues"]}
        self.assertIn("orientation_portrait", codes)

    def test_gap_fill_returns_auditable_mask_metadata(self):
        image = textured_image()
        evidence = np.full(image.shape[:2], 255, dtype=np.uint8)
        evidence[200:300, 400:550] = 0
        completed, generated_mask, metadata = placeholder_ai_gap_fill(image, evidence)
        self.assertEqual(completed.shape, image.shape)
        self.assertEqual(int(np.count_nonzero(generated_mask)), 15000)
        self.assertTrue(metadata["used"])
        self.assertEqual(metadata["method"], "opencv_telea_placeholder")
        self.assertEqual(len(metadata["regions"]), 1)
        self.assertGreater(metadata["filled_ratio"], 0)

    def test_nested_large_gap_is_not_filled_by_small_component_bounds(self):
        image = np.full((200, 200, 3), 120, dtype=np.uint8)
        evidence = np.full((200, 200), 255, dtype=np.uint8)
        cv2.rectangle(evidence, (20, 20), (180, 180), 0, 1)
        evidence[40:160, 40:160] = 0
        completed, generated, metadata = placeholder_ai_gap_fill(image, evidence)
        self.assertTrue(metadata["used"])
        self.assertFalse(np.any(generated[40:160, 40:160]))
        self.assertEqual(len(metadata["unresolved_regions"]), 1)
        np.testing.assert_array_equal(completed[40:160, 40:160], image[40:160, 40:160])
        self.assertEqual(np.count_nonzero(generated), 640)

    def test_tiny_gaps_are_included_in_completion_accounting(self):
        image = np.full((100, 100, 3), 120, dtype=np.uint8)
        evidence = np.full((100, 100), 255, dtype=np.uint8)
        evidence[50, 50] = 0
        _, generated, metadata = placeholder_ai_gap_fill(image, evidence)
        self.assertEqual(np.count_nonzero(generated), 1)
        self.assertEqual(metadata["regions"][0]["pixel_count"], 1)

    def test_sparse_match_neighbours_do_not_crash(self):
        first = cv2.DMatch(0, 0, 1.0)
        second = cv2.DMatch(0, 1, 10.0)
        self.assertEqual(service._ratio_matches([[], [first], [first, second]], 0.78), [first])

    def test_real_pair_stitch_preserves_binary_evidence(self):
        first = textured_image()
        second = np.roll(first, 80, axis=1)
        panorama, evidence, metrics = service._stitch_pair(first, second, "orb", 1, 4.0)
        self.assertEqual(panorama.shape[:2], evidence.shape)
        self.assertTrue(set(np.unique(evidence)).issubset({0, 255}))
        self.assertGreaterEqual(metrics.inliers, 8)

    def test_projective_horizon_is_rejected_before_warp_allocation(self):
        first = textured_image()
        invalid = np.array([[1., 0., 0.], [0., 1., 0.], [-0.002, 0., 1.]])
        with patch.object(service.cv2, "findHomography", return_value=(invalid, np.ones((10000, 1), np.uint8))):
            with self.assertRaisesRegex(service.StitchingError, "invalid projective warp"):
                service._stitch_pair(first, first.copy(), "orb", 1, 4.0)

    def test_hybrid_rejects_invalid_threshold_before_processing(self):
        for threshold in (float("nan"), float("inf"), 0.0, 11.0):
            with self.subTest(threshold=threshold), self.assertRaises(service.StitchingError):
                service.reconstruct_hybrid_panorama([np.zeros((1, 1, 3), np.uint8)] * 6, ransac_threshold=threshold)


if __name__ == "__main__":
    unittest.main()
