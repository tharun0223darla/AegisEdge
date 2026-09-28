from __future__ import annotations

import json
import os
import re
import shutil
import statistics
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageOps
import numpy as np
from paddleocr import PaddleOCR


IMAGE_PATH = Path(
    r"C:\Users\tharu\meditrack-ai\uploads\prescriptions"
    r"\15996936-6a79-4433-9fcf-7512d875f606.jpeg"
)

OUTPUT_DIR = Path(
    r"C:\Users\tharu\meditrack-ai\ocr-service"
    r"\medicine-row-output-final"
)


# Runtime overrides used by prescription_vision_pipeline.py.
IMAGE_PATH = Path(
    os.environ.get(
        "MEDITRACK_IMAGE_PATH",
        str(IMAGE_PATH),
    )
)

OUTPUT_DIR = Path(
    os.environ.get(
        "MEDITRACK_OUTPUT_DIR",
        str(OUTPUT_DIR),
    )
)

DET_MODEL_DIR = Path(
    r"C:\Users\tharu\.paddlex\official_models"
    r"\PP-OCRv5_mobile_det"
)

REC_MODEL_DIR = Path(
    r"C:\Users\tharu\.paddlex\official_models"
    r"\PP-OCRv5_mobile_rec"
)


DOSAGE_FORM_PATTERN = re.compile(
    r"\b(tab|tablet|tb|cap|capsule|syr|syrup|syp|"
    r"inj|injection|cream|ointment|oint|gel|drops?|"
    r"lotion|powder|sachet|respule|inhaler)\b",
    re.IGNORECASE,
)

NUMBERED_ROW_PATTERN = re.compile(
    r"^\s*[1-9]\d?\s*[\.\)\-:]?"
)

EXCLUDED_PATTERN = re.compile(
    r"\b(name|age|sex|gender|date|address|phone|hospital|"
    r"doctor|consultant|diagnosis|complaint|history|pulse|"
    r"temperature|weight|height|blood pressure|allergies|"
    r"registration|department|signature|consultation|before)\b",
    re.IGNORECASE,
)


def is_probable_medicine_row(text: str) -> bool:
    clean = text.strip()

    if not clean or EXCLUDED_PATTERN.search(clean):
        return False

    has_form = bool(DOSAGE_FORM_PATTERN.search(clean))
    has_number = bool(NUMBERED_ROW_PATTERN.search(clean))
    has_letters = len(re.findall(r"[A-Za-z]", clean)) >= 4

    return has_form or (has_number and has_letters)


def enhance_crop_for_reading(crop: Image.Image) -> Image.Image:
    """Make faint handwriting easier for the vision model to inspect."""
    gray = ImageOps.grayscale(crop)
    enhanced = ImageOps.autocontrast(gray, cutoff=1)
    enhanced = enhanced.filter(
        ImageFilter.UnsharpMask(
            radius=1.2,
            percent=180,
            threshold=3,
        )
    )

    return Image.merge("RGB", (enhanced, enhanced, enhanced))


def find_content_box(
    image: Image.Image,
    *,
    margin_ratio: float = 0.035,
) -> tuple[int, int, int, int] | None:
    gray = np.asarray(ImageOps.grayscale(image))
    height, width = gray.shape

    if width < 80 or height < 80:
        return None

    threshold = min(
        248,
        max(170, float(np.percentile(gray, 18)) + 42),
    )
    mask = gray < threshold

    if float(mask.mean()) < 0.002:
        return None

    ys, xs = np.nonzero(mask)

    if not len(xs) or not len(ys):
        return None

    margin = int(min(width, height) * margin_ratio)
    x1 = max(0, int(xs.min()) - margin)
    y1 = max(0, int(ys.min()) - margin)
    x2 = min(width, int(xs.max()) + margin + 1)
    y2 = min(height, int(ys.max()) + margin + 1)

    crop_width = x2 - x1
    crop_height = y2 - y1

    if crop_width < width * 0.38 or crop_height < height * 0.38:
        return None

    if (
        x1 < width * 0.025
        and y1 < height * 0.025
        and x2 > width * 0.975
        and y2 > height * 0.975
    ):
        return None

    return (x1, y1, x2, y2)


def estimate_skew_angle(image: Image.Image) -> float:
    gray = ImageOps.grayscale(image)
    width, height = gray.size
    scale = min(1.0, 900 / max(width, height))

    if scale < 1:
        gray = gray.resize(
            (
                max(1, int(width * scale)),
                max(1, int(height * scale)),
            ),
            Image.Resampling.BILINEAR,
        )

    values = np.asarray(gray)
    threshold = min(
        235,
        max(120, float(np.percentile(values, 32))),
    )
    ink = values < threshold
    ink_ratio = float(ink.mean())

    if ink_ratio < 0.002 or ink_ratio > 0.34:
        return 0.0

    mask = Image.fromarray((ink * 255).astype("uint8"), mode="L")

    def projection_score(angle: float) -> float:
        rotated = mask.rotate(
            angle,
            resample=Image.Resampling.NEAREST,
            expand=True,
            fillcolor=0,
        )
        projection = (np.asarray(rotated) > 0).sum(axis=1)
        return float(np.var(projection))

    baseline = projection_score(0.0)
    best_angle = 0.0
    best_score = baseline

    for step in range(-8, 9):
        angle = step * 0.5

        if angle == 0:
            continue

        score = projection_score(angle)

        if score > best_score:
            best_score = score
            best_angle = angle

    if abs(best_angle) < 0.4 or best_score < baseline * 1.08:
        return 0.0

    return best_angle


def prepare_page_for_reading(
    source_path: Path,
    output_path: Path,
) -> tuple[Image.Image, Image.Image, dict]:
    source = ImageOps.exif_transpose(
        Image.open(source_path).convert("RGB")
    )
    steps: dict = {
        "source_file": str(source_path),
        "page_crop_box": None,
        "deskew_angle_degrees": 0.0,
        "preprocessed_file": str(output_path),
    }

    content_box = find_content_box(source)

    if content_box is not None:
        source = source.crop(content_box)
        steps["page_crop_box"] = list(content_box)

    angle = estimate_skew_angle(source)

    if angle:
        source = source.rotate(
            angle,
            resample=Image.Resampling.BICUBIC,
            expand=True,
            fillcolor=(255, 255, 255),
        )
        steps["deskew_angle_degrees"] = round(angle, 2)

        rotated_box = find_content_box(source, margin_ratio=0.02)

        if rotated_box is not None:
            source = source.crop(rotated_box)

    normalized = source.copy()
    prepared = enhance_crop_for_reading(source)
    prepared.save(output_path, quality=95)

    return prepared, normalized, steps


def geometry_fallback_candidates(
    image: Image.Image,
    *,
    sparse_body_mode: bool = False,
) -> list[dict]:
    """Detect handwriting rows when OCR recognition is too weak."""
    gray = np.asarray(image.convert("L"))
    page_height, page_width = gray.shape

    region_x1 = int(page_width * 0.04)
    region_x2 = int(page_width * 0.97)
    region_y1 = int(page_height * 0.26)
    region_y2 = int(page_height * 0.96)

    region = gray[region_y1:region_y2, region_x1:region_x2]
    background = np.asarray(
        Image.fromarray(region)
        .filter(
            ImageFilter.GaussianBlur(
                radius=max(8, int(min(region.shape) * 0.035)),
            )
        )
        .convert("L")
    )
    contrast = background.astype(np.int16) - region.astype(np.int16)
    contrast_threshold = max(
        8.0,
        float(np.percentile(contrast, 91)) * 0.45,
    )
    ink_level = max(
        170.0,
        float(np.percentile(region, 22)),
    )
    dark = (
        (contrast >= contrast_threshold)
        | (region <= ink_level)
    ) & (region < 235)

    dense_rows = dark.mean(axis=1) > 0.38
    dark[dense_rows, :] = False

    density = dark.sum(axis=1).astype(float)
    smooth = np.convolve(
        density,
        np.ones(5) / 5,
        mode="same",
    )

    threshold = max(3.0, region.shape[1] * 0.008)
    active = smooth >= threshold

    raw_bands = []
    index = 0

    while index < len(active):
        if not active[index]:
            index += 1
            continue

        start = index

        while index < len(active) and active[index]:
            index += 1

        end = index - 1

        if end - start + 1 >= 4:
            raw_bands.append(
                (start + region_y1, end + region_y1)
            )

    merged_bands = []

    for start, end in raw_bands:
        if (
            merged_bands
            and start - merged_bands[-1][1] <= 14
        ):
            previous_start, _ = merged_bands[-1]
            merged_bands[-1] = (previous_start, end)
        else:
            merged_bands.append((start, end))

    raw_bands = merged_bands

    def split_band(start: int, end: int):
        if end - start + 1 <= 52:
            return [(start, end)]

        local_start = start - region_y1
        local_end = end - region_y1 + 1
        values = smooth[local_start:local_end]

        left = max(1, int(len(values) * 0.30))
        right = min(
            len(values) - 1,
            int(len(values) * 0.70),
        )

        if right <= left:
            split = (start + end) // 2
        else:
            split = (
                start
                + left
                + int(np.argmin(values[left:right]))
            )

        if split - start < 14 or end - split < 14:
            split = (start + end) // 2

        return (
            split_band(start, split - 1)
            + split_band(split + 1, end)
        )

    bands = []

    for start, end in raw_bands:
        bands.extend(split_band(start, end))

    candidates = []

    for row_number, (start, end) in enumerate(
        bands,
        start=1,
    ):
        candidates.append(
            {
                "text": f"geometry-row-{row_number}",
                "confidence": 0.0,
                "x1": region_x1,
                "y1": start,
                "x2": region_x2,
                "y2": end,
                "cx": (region_x1 + region_x2) / 2,
                "cy": (start + end) / 2,
            }
        )

    if (
        candidates
        and sparse_body_mode
        and should_use_sparse_body_mode(
            candidates,
            page_width,
            page_height,
        )
    ):
        return sparse_body_fallback_candidates(
            page_width,
            page_height,
            [(item["y1"], item["y2"]) for item in candidates],
        )

    if candidates:
        return candidates

    return sparse_body_fallback_candidates(
        page_width,
        page_height,
    )


def should_use_sparse_body_mode(
    candidates: list[dict],
    page_width: int,
    page_height: int,
) -> bool:
    if not candidates:
        return True

    first_top = min(int(item["y1"]) for item in candidates)
    average_width = statistics.mean(
        int(item["x2"]) - int(item["x1"])
        for item in candidates
    )
    width_ratio = average_width / max(1, page_width)

    if len(candidates) <= 4:
        return True

    return (
        first_top > int(page_height * 0.28)
        and width_ratio > 0.86
    )


def sparse_body_fallback_candidates(
    page_width: int,
    page_height: int,
    bands: list[tuple[int, int]] | None = None,
) -> list[dict]:
    """Last-resort broad crops for sparse prescriptions.

    Some real prescriptions contain one medicine plus loose dosage
    instructions. In those cases Paddle may return no usable row anchors.
    Broad body crops let Qwen review visible text instead of failing the job.
    """
    x1 = int(page_width * 0.04)
    x2 = int(page_width * 0.97)
    if bands:
        top = min(start for start, _ in bands)
        bottom = max(end for _, end in bands)
        padding = max(48, int(page_height * 0.055))
        y_start = max(int(page_height * 0.24), top - padding)
        y_end = min(int(page_height * 0.90), bottom + padding)
    else:
        y_start = int(page_height * 0.30)
        y_end = int(page_height * 0.82)

    row_count = 3
    body_height = max(1, y_end - y_start)
    crop_height = max(120, int(body_height * 0.56))

    if body_height <= crop_height:
        starts = [y_start]
    else:
        starts = [
            y_start,
            y_start + max(0, int((body_height - crop_height) * 0.50)),
            y_end - crop_height,
        ]

    unique_starts = []

    for start in starts[:row_count]:
        if all(abs(start - existing) > 18 for existing in unique_starts):
            unique_starts.append(start)

    candidates = []

    for row_number, start in enumerate(unique_starts, start=1):
        y1 = min(page_height - 1, max(0, int(start)))
        y2 = min(page_height, y1 + crop_height)

        candidates.append(
            {
                "text": f"sparse-body-crop-{row_number}",
                "confidence": 0.0,
                "x1": x1,
                "y1": y1,
                "x2": x2,
                "y2": y2,
                "cx": (x1 + x2) / 2,
                "cy": (y1 + y2) / 2,
                "crop_mode": "sparse_body",
            }
        )

    return candidates


def read_result(result) -> dict:
    data = result.json

    if isinstance(data, str):
        data = json.loads(data)

    return data.get("res", data)


def remove_duplicates(
    candidates: list[dict],
    page_height: int,
) -> list[dict]:
    tolerance_y = max(16, int(page_height * 0.016))
    kept: list[dict] = []

    for candidate in sorted(
        candidates,
        key=lambda item: (-item["confidence"], item["cy"]),
    ):
        duplicate = any(
            abs(candidate["cy"] - existing["cy"]) <= tolerance_y
            and abs(candidate["cx"] - existing["cx"]) <= 250
            for existing in kept
        )

        if not duplicate:
            kept.append(candidate)

    return sorted(kept, key=lambda item: (item["cy"], item["x1"]))


def group_columns(
    candidates: list[dict],
    page_width: int,
) -> list[list[dict]]:
    groups: list[list[dict]] = []
    threshold = page_width * 0.19

    for candidate in sorted(candidates, key=lambda item: item["cx"]):
        selected = None
        best_distance = float("inf")

        for group in groups:
            mean_x = statistics.mean(item["cx"] for item in group)
            distance = abs(candidate["cx"] - mean_x)

            if distance <= threshold and distance < best_distance:
                selected = group
                best_distance = distance

        if selected is None:
            groups.append([candidate])
        else:
            selected.append(candidate)

    groups.sort(
        key=lambda group: statistics.mean(item["cx"] for item in group)
    )

    for group in groups:
        group.sort(key=lambda item: item["cy"])

    return groups


def column_ranges(
    columns: list[list[dict]],
    page_width: int,
) -> list[tuple[int, int]]:
    if len(columns) == 1:
        return [(0, page_width)]

    centres = [
        statistics.mean(item["cx"] for item in column)
        for column in columns
    ]

    splits = [
        int((centres[i] + centres[i + 1]) / 2)
        for i in range(len(centres) - 1)
    ]

    ranges = []

    for i in range(len(columns)):
        left = 0 if i == 0 else splits[i - 1]
        right = page_width if i == len(columns) - 1 else splits[i]
        ranges.append((left, right))

    return ranges


def estimate_pitch(
    columns: list[list[dict]],
    page_height: int,
) -> int:
    gaps = []

    for column in columns:
        for i in range(len(column) - 1):
            gap = int(column[i + 1]["cy"] - column[i]["cy"])

            if gap > 0:
                gaps.append(gap)

    pitch = (
        int(statistics.median(gaps))
        if gaps
        else int(page_height * 0.08)
    )

    return max(
        int(page_height * 0.05),
        min(pitch, int(page_height * 0.12)),
    )


def main() -> None:
    for path, label in (
        (IMAGE_PATH, "Prescription"),
        (DET_MODEL_DIR, "Detection model"),
        (REC_MODEL_DIR, "Recognition model"),
    ):
        if not path.exists():
            raise FileNotFoundError(f"{label} not found: {path}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Remove only regenerated evidence while preserving Qwen cache files.
    for child in OUTPUT_DIR.iterdir():
        if child.is_dir() and child.name.startswith("row_"):
            shutil.rmtree(child)

    for filename in (
        "metadata.json",
        "contact-sheet.jpg",
        "preprocessed-page.jpg",
        "preprocess-metadata.json",
    ):
        generated_file = OUTPUT_DIR / filename
        if generated_file.exists():
            generated_file.unlink()

    preprocessed_path = OUTPUT_DIR / "preprocessed-page.jpg"
    image, geometry_image, preprocess_steps = prepare_page_for_reading(
        IMAGE_PATH,
        preprocessed_path,
    )
    preprocess_metadata_path = OUTPUT_DIR / "preprocess-metadata.json"
    preprocess_metadata_path.write_text(
        json.dumps(preprocess_steps, indent=2),
        encoding="utf-8",
    )

    print("Loading local PaddleOCR models...")

    ocr = PaddleOCR(
        text_detection_model_name="PP-OCRv5_mobile_det",
        text_detection_model_dir=str(DET_MODEL_DIR),
        text_recognition_model_name="PP-OCRv5_mobile_rec",
        text_recognition_model_dir=str(REC_MODEL_DIR),
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        device="gpu:0",
    )

    print("Reading prescription...")

    results = ocr.predict(str(preprocessed_path))

    if not results:
        raise RuntimeError("PaddleOCR returned no result.")

    payload = read_result(results[0])

    texts = list(payload.get("rec_texts", []))
    scores = list(payload.get("rec_scores", []))
    boxes = list(payload.get("rec_boxes", []))

    page_width, page_height = image.size

    candidates = []

    for text, score, box in zip(texts, scores, boxes):
        clean = str(text).strip()

        if not is_probable_medicine_row(clean):
            continue

        x1, y1, x2, y2 = [int(value) for value in box]

        candidates.append(
            {
                "text": clean,
                "confidence": float(score),
                "x1": x1,
                "y1": y1,
                "x2": x2,
                "y2": y2,
                "cx": (x1 + x2) / 2,
                "cy": (y1 + y2) / 2,
            }
        )

    candidates = remove_duplicates(candidates, page_height)

    if len(candidates) < 3:
        print(
            "OCR text anchors were insufficient; "
            "using adaptive handwriting fallback..."
        )
        candidates = geometry_fallback_candidates(
            geometry_image,
            sparse_body_mode=True,
        )

    if not candidates:
        raise RuntimeError("No probable medicine rows detected.")

    columns = group_columns(candidates, page_width)
    ranges = column_ranges(columns, page_width)
    pitch = estimate_pitch(columns, page_height)

    rows = []

    for column_index, (column, x_range) in enumerate(
        zip(columns, ranges),
        start=1,
    ):
        column_x1, column_x2 = x_range

        for column_row, anchor in enumerate(column, start=1):
            crop_mode = str(anchor.get("crop_mode") or "row")

            if crop_mode == "sparse_body":
                x1 = max(0, int(anchor["x1"]))
                x2 = min(page_width, int(anchor["x2"]))
                y1 = max(0, int(anchor["y1"]))
                y2 = min(page_height, int(anchor["y2"]))
            else:
                centre_y = int(anchor["cy"])

                half_height = max(
                    28,
                    min(38, int(pitch * 0.30)),
                )

                y1 = max(0, centre_y - half_height)
                y2 = min(page_height, centre_y + half_height)

                x1 = max(column_x1, int(anchor["x1"] - 45))
                x2 = column_x2

            crop = image.crop((x1, y1, x2, y2))

            if crop_mode == "sparse_body":
                crop = enhance_crop_for_reading(crop)

            rows.append(
                {
                    "column": column_index,
                    "column_row": column_row,
                    "anchor_text": anchor["text"],
                    "confidence": round(anchor["confidence"], 4),
                    "crop_mode": crop_mode,
                    "box": [x1, y1, x2, y2],
                    "crop": crop,
                }
            )

    rows.sort(key=lambda row: (row["box"][1], row["box"][0]))

    metadata = []
    contact_items = []

    for output_row, row in enumerate(rows, start=1):
        row_dir = OUTPUT_DIR / f"row_{output_row:02d}"
        row_dir.mkdir(parents=True, exist_ok=True)

        crop_path = row_dir / "name.jpg"
        row["crop"].save(crop_path, quality=95)

        metadata.append(
            {
                "output_row": output_row,
                "column": row["column"],
                "column_row": row["column_row"],
                "ocr_anchor_text": row["anchor_text"],
                "ocr_confidence": row["confidence"],
                "crop_mode": row["crop_mode"],
                "crop_box": row["box"],
                "name_file": str(crop_path),
                "page_image_file": str(preprocessed_path),
                "preprocess": preprocess_steps,
            }
        )

        contact_items.append(
            (f"Medicine row {output_row}", row["crop"])
        )

    metadata_path = OUTPUT_DIR / "metadata.json"
    metadata_path.write_text(
        json.dumps(metadata, indent=2),
        encoding="utf-8",
    )

    contact_width = max(
        crop.width for _, crop in contact_items
    )
    contact_height = sum(
        crop.height + 36 for _, crop in contact_items
    )

    sheet = Image.new(
        "RGB",
        (contact_width, contact_height),
        "white",
    )

    draw = ImageDraw.Draw(sheet)
    current_y = 0

    for label, crop in contact_items:
        draw.text((8, current_y + 8), label, fill="black")
        sheet.paste(crop, (0, current_y + 28))
        current_y += crop.height + 36

    contact_path = OUTPUT_DIR / "contact-sheet.jpg"
    sheet.save(contact_path, quality=95)

    print()
    print("FINAL MEDICINE NAME-CROP DETECTION COMPLETE")
    print("-------------------------------------------")
    print(f"Detected columns: {len(columns)}")
    print(f"Detected rows:    {len(metadata)}")
    print(f"Estimated pitch:  {pitch}px")
    print()
    print(f"Output directory: {OUTPUT_DIR}")
    print(f"Metadata:         {metadata_path}")
    print(f"Contact sheet:    {contact_path}")


if __name__ == "__main__":
    main()
