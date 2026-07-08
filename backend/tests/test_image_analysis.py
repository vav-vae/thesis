import unittest

import cv2
import numpy as np

try:
    from backend.services.panorama_service import analyze_image_sequence, placeholder_ai_gap_fill
except ImportError:
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
        pair_codes = {issue["code"] for issue in result["pairs"][0]["issues"]}

        self.assertFalse(result["can_stitch"])
        self.assertIn("overlap_insufficient", pair_codes)

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


if __name__ == "__main__":
    unittest.main()
