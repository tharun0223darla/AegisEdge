from __future__ import annotations

import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image, ImageFile

ImageFile.LOAD_TRUNCATED_IMAGES = True


def smooth(values: np.ndarray, window: int) -> np.ndarray:
    if len(values) < window or window <= 1:
        return values
    kernel = np.ones(window, dtype=np.float32) / float(window)
    return np.convolve(values, kernel, mode="same")


def merge_ranges(ranges: list[tuple[int, int]], max_gap: int) -> list[tuple[int, int]]:
    if not ranges:
        return []

    merged = [ranges[0]]
    for start, end in ranges[1:]:
        prev_start, prev_end = merged[-1]
        if start - prev_end <= max_gap:
            merged[-1] = (prev_start, max(prev_end, end))
        else:
            merged.append((start, end))

    return merged


def active_ranges(active: np.ndarray) -> list[tuple[int, int]]:
    ranges: list[tuple[int, int]] = []
    index = 0

    while index < len(active):
        if not active[index]:
            index += 1
            continue

        start = index
        while index < len(active) and active[index]:
            index += 1
        ranges.append((start, index - 1))

    return ranges


def detect_boxes(image_path: Path) -> list[list[float]]:
    image = Image.open(image_path).convert("L")
    gray = np.asarray(image, dtype=np.uint8)
    height, width = gray.shape

    # Work in the prescription body and ignore much of the header/footer noise.
    y0 = int(height * 0.14)
    y1 = int(height * 0.96)
    x0 = int(width * 0.03)
    x1 = int(width * 0.98)
    region = gray[y0:y1, x0:x1]

    if region.size == 0:
        return []

    median = float(np.median(region))
    if median >= 128:
        foreground = region < max(70, min(205, median - 28))
    else:
        foreground = region > min(230, max(70, median + 34))

    # Suppress dense printed tables/borders that tend to span most of the page.
    row_foreground_ratio = foreground.mean(axis=1)
    foreground[row_foreground_ratio > 0.62, :] = False

    row_density = foreground.sum(axis=1).astype(np.float32)
    row_density = smooth(row_density, max(5, int(height * 0.004)))
    positive = row_density[row_density > 0]
    if positive.size == 0:
        return []

    threshold = max(region.shape[1] * 0.012, float(np.percentile(positive, 58)))
    rows = active_ranges(row_density >= threshold)
    rows = merge_ranges(rows, max(4, int(height * 0.008)))

    boxes: list[list[float]] = []
    min_height = max(8, int(height * 0.006))
    max_height = max(80, int(height * 0.12))
    min_width = max(45, int(width * 0.07))

    for start, end in rows:
        band_height = end - start + 1
        if band_height < min_height or band_height > max_height:
            continue

        band = foreground[start : end + 1, :]
        col_density = band.sum(axis=0).astype(np.float32)
        col_density = smooth(col_density, max(5, int(width * 0.004)))
        col_positive = col_density[col_density > 0]
        if col_positive.size == 0:
            continue

        col_threshold = max(band_height * 0.08, float(np.percentile(col_positive, 48)))
        columns = active_ranges(col_density >= col_threshold)
        columns = merge_ranges(columns, max(8, int(width * 0.012)))

        for col_start, col_end in columns:
            box_width = col_end - col_start + 1
            if box_width < min_width:
                continue

            pad_x = max(6, int(width * 0.008))
            pad_y = max(5, int(height * 0.006))
            x = max(0, x0 + col_start - pad_x)
            y = max(0, y0 + start - pad_y)
            right = min(width, x0 + col_end + pad_x)
            bottom = min(height, y0 + end + pad_y)

            if right - x >= min_width and bottom - y >= min_height:
                boxes.append([float(x), float(y), float(right - x), float(bottom - y)])

    # Keep the strongest practical set per page. This is a review aid, not truth.
    boxes.sort(key=lambda box: (box[1], box[0]))
    deduped: list[list[float]] = []
    for box in boxes:
        x, y, w, h = box
        cy = y + h / 2
        if any(abs(cy - (other[1] + other[3] / 2)) < max(10, h * 0.55) for other in deduped):
            continue
        deduped.append(box)

    return deduped[:14]


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    dataset_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else repo_root / "datasets" / "prescription_medicine_detection"
    manifest_path = dataset_dir / "manifest.json"
    images_dir = dataset_dir / "images" / "raw"
    output_path = dataset_dir / "annotations" / "medicine_boxes.geometry_prelabels.coco.json"

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    annotations = []
    image_statuses = {}
    annotation_id = 1

    for image in manifest["images"]:
        boxes = detect_boxes(images_dir / image["file_name"])
        if boxes:
            image_statuses[str(image["id"])] = {
                "status": "auto_proposed",
                "box_count": len(boxes),
                "method": "geometry",
            }

        for box in boxes:
            annotations.append(
                {
                    "id": annotation_id,
                    "image_id": image["id"],
                    "category_id": 1,
                    "bbox": [round(value, 2) for value in box],
                    "area": round(box[2] * box[3], 2),
                    "iscrowd": 0,
                    "attributes": {
                        "label": "medicine_name",
                        "review_state": "auto_proposed",
                        "method": "geometry",
                    },
                }
            )
            annotation_id += 1

    now = datetime.now(timezone.utc).isoformat()
    payload = {
        "info": {
            "description": "Geometry-only prelabels for review. Do not train directly without human review.",
            "version": "0.1.0",
            "created_at": now,
        },
        "licenses": [],
        "images": [
            {
                "id": image["id"],
                "file_name": image["file_name"],
                "width": image["width"],
                "height": image["height"],
                "split": image["split"],
                "source_entry": image["source_entry"],
            }
            for image in manifest["images"]
        ],
        "annotations": annotations,
        "categories": [{"id": 1, "name": "medicine_name", "supercategory": "prescription"}],
        "image_statuses": image_statuses,
    }

    output_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Wrote {len(annotations)} geometry prelabel boxes for {len(image_statuses)} images")
    print(output_path)


if __name__ == "__main__":
    main()
