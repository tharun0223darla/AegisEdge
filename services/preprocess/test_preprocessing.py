import unittest

import numpy as np

from preprocessing import (
    build_ocr_variants,
    is_reversed_bill_layout,
    is_vertical_text_layout,
    rotate_line_geometry_180,
)


class PrintedVariantTests(unittest.TestCase):
    def setUp(self):
        self.image = np.full((640, 960, 3), 255, dtype=np.uint8)

    def test_bill_uses_all_bounded_printed_variants(self):
        variants = build_ocr_variants(self.image, "bill", 4)
        self.assertEqual(
            [variant.name for variant in variants],
            ["original", "contrast", "illumination", "threshold"],
        )

    def test_package_variant_count_remains_bounded(self):
        variants = build_ocr_variants(self.image, "package", 99)
        self.assertEqual(len(variants), 4)

    def test_printed_documents_use_cpu_safe_resolution(self):
        bill = build_ocr_variants(self.image, "bill", 1)[0].image
        prescription = build_ocr_variants(
            self.image, "prescription", 1
        )[0].image

        self.assertEqual(max(bill.shape[:2]), 1800)
        self.assertEqual(max(prescription.shape[:2]), 2200)

    def test_vertical_ocr_geometry_requests_quarter_turn(self):
        lines = [
            {
                "text": "QDOL-PT4",
                "bbox": [[10, 10], [30, 10], [30, 180], [10, 180]],
            },
            {
                "text": "HAPIRAB D",
                "bbox": [[40, 10], [60, 10], [60, 190], [40, 190]],
            },
            {
                "text": "1X10",
                "bbox": [[70, 10], [90, 10], [90, 100], [70, 100]],
            },
        ]

        self.assertTrue(is_vertical_text_layout(lines))

    def test_horizontal_ocr_geometry_is_not_rotated(self):
        lines = [
            {
                "text": "QDOL-PT4",
                "bbox": [[10, 10], [180, 10], [180, 30], [10, 30]],
            },
            {
                "text": "HAPIRAB D",
                "bbox": [[10, 40], [190, 40], [190, 60], [10, 60]],
            },
            {
                "text": "1X10",
                "bbox": [[10, 70], [100, 70], [100, 90], [10, 90]],
            },
        ]

        self.assertFalse(is_vertical_text_layout(lines))

    def test_reversed_bill_columns_are_detected_and_remapped(self):
        lines = [
            {
                "text": "Amount",
                "bbox": [[10, 10], [80, 10], [80, 30], [10, 30]],
            },
            {
                "text": "Description",
                "bbox": [[700, 10], [850, 10], [850, 30], [700, 30]],
            },
        ]

        self.assertTrue(is_reversed_bill_layout(lines))
        remapped = rotate_line_geometry_180(lines, 1000, 600)
        self.assertGreater(remapped[0]["bbox"][0][0], remapped[1]["bbox"][0][0])


if __name__ == "__main__":
    unittest.main()
