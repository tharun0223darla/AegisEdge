from __future__ import annotations

import json
import re
import statistics
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from paddleocr import PaddleOCR


IMAGE_PATH = Path(
    r"C:\Users\tharu\meditrack-ai\uploads\prescriptions"
    r"\15996936-6a79-4433-9fcf-7512d875f606.jpeg"
)

OUTPUT_DIR = Path(
    r"C:\Users\tharu\meditrack-ai\ocr-service\auto-row-crops-v4"
)

DETECTION_MODEL_DIR = Path(
    r"C:\Users\tharu\.paddlex\official_models"
    r"\PP-OCRv5_mobile_det"
)

RECOGNITION_MODEL_DIR = Path(
    r"C:\Users\tharu\.paddlex\official_models"
    r"\PP-OCRv5_mobile_rec"
)


DOSAGE_FORM_PATTERN = re.compile(
    r"\b("
    r"tab|tablet|tb|cap|capsule|syr|syrup|syp|"
    r"inj|injection|cream|ointment|oint|gel|"
    r"drops?|lotion|powder|sachet|respule|inhaler"
    r")\b",
    re.IGNORECASE,
)

NUMBERED_ROW_PATTERN = re.compile(
    r"^\s*[1-9]\d?\s*[\.\)\-:]?",
    re.IGNORECASE,
)

EXCLUDED_PATTERN = re.compile(
    r"\b("
    r"name|age|sex|gender|date|address|phone|hospital|"
    r"doctor|consultant|diagnosis|complaint|history|"
    r"pulse|temperature|weight|height|blood pressure|"
    r"allergies|registration|department|signature"
    r")\b",
    re.IGNORECASE,
)


def is_probable_medicine_row(text: str) -> bool:
    clean = text.strip()

    if not clean or EXCLUDED_PATTERN.search(clean):
        return False

    has_dosage_form = bool(DOSAGE_FORM_PATTERN.search(clean))
    has_row_number = bool(NUMBERED_ROW_PATTERN.search(clean))
    has_letters = len(re.findall(r"[A-Za-z]", clean)) >= 4

    return has_dosage_form or (has_row_number and has_letters)


def read_result(result) -> dict:
    data = result.json

    if isinstance(data, str):
        data = json.loads(data)

    return data.get("res", data)


def group_into_columns(
    candidates: list[dict],
    page_width: int,
) -> list[list[dict]]:
    groups: list[list[dict]] = []
    threshold = page_width * 0.18

    for candidate in sorted(candidates, key=lambda item: item["x1"]):
        selected_group = None
        selected_distance = float("inf")

        for group in groups:
            mean_x = statistics.mean(item["x1"] for item in group)
            distance = abs(candidate["x1"] - mean_x)

            if distance <= threshold and distance < selected_distance:
                selected_group = group
                selected_distance = distance

        if selected_group is None:
            groups.append([candidate])
        else:
            selected_group.append(candidate)

    groups.sort(
        key=lambda group: statistics.mean(item["x1"] for item in group)
    )

    for group in groups:
        group.sort(key=lambda item: item["cy"])

    return groups


def smooth(values: np.ndarray, window: int = 9) -> np.ndarray:
    if len(values) < window:
        return values

    kernel = np.ones(window, dtype=np.float32) / window
    return np.convolve(values, kernel, mode="same")


def find_whitespace_boundary(
    gray: np.ndarray,
    x1: int,
    x2: int,
    search_y1: int,
    search_y2: int,
) -> int:
    """
    Find the strongest horizontal whitespace valley inside a search interval.

    The score measures the fraction of dark pixels on each horizontal line.
    Lower scores indicate clearer separation between prescription rows.
    """
    height, width = gray.shape

    x1 = int(x1)
    x2 = int(x2)
    search_y1 = int(search_y1)
    search_y2 = int(search_y2)

    x1 = max(0, min(x1, width - 1))
    x2 = max(x1 + 1, min(x2, width))
    search_y1 = max(0, min(search_y1, height - 1))
    search_y2 = max(search_y1 + 1, min(search_y2, height))

    region = gray[search_y1:search_y2, x1:x2]

    if region.size == 0:
        return (search_y1 + search_y2) // 2

    # Ignore very light background; handwriting and printed lines are dark.
    dark_ratio = (region < 190).mean(axis=1).astype(np.float32)
    scores = smooth(dark_ratio, window=9)

    # Avoid selecting the extreme edges of the search window.
    edge = max(3, int(len(scores) * 0.12))
    usable = scores[edge:len(scores) - edge]

    if usable.size == 0:
        return (search_y1 + search_y2) // 2

    minimum = float(usable.min())
    threshold = minimum + 0.004

    candidate_indices = np.where(usable <= threshold)[0]

    if candidate_indices.size == 0:
        relative_index = int(np.argmin(usable))
    else:
        # Prefer the middle of the lowest continuous whitespace area.
        relative_index = int(np.median(candidate_indices))

    return search_y1 + edge + relative_index


def build_column_boundaries(
    gray: np.ndarray,
    column: list[dict],
    x1: int,
    x2: int,
    page_height: int,
) -> list[tuple[int, int]]:
    if len(column) > 1:
        pitches = [
            column[index + 1]["cy"] - column[index]["cy"]
            for index in range(len(column) - 1)
            if column[index + 1]["cy"] > column[index]["cy"]
        ]
        typical_pitch = int(statistics.median(pitches))
    else:
        typical_pitch = int(page_height * 0.085)

    typical_pitch = max(
        int(page_height * 0.06),
        min(typical_pitch, int(page_height * 0.13)),
    )

    boundaries: list[int] = []

    for index in range(len(column) - 1):
        current = column[index]
        following = column[index + 1]

        search_y1 = max(
            current["y2"] + 12,
            int(current["cy"] + typical_pitch * 0.25),
        )
        search_y2 = min(
            following["y1"] - 6,
            int(following["cy"] - typical_pitch * 0.18),
        )

        if search_y2 <= search_y1:
            boundary = int((current["cy"] + following["cy"]) / 2)
        else:
            boundary = find_whitespace_boundary(
                gray,
                x1,
                x2,
                search_y1,
                search_y2,
            )

        boundaries.append(boundary)

    bands: list[tuple[int, int]] = []

    for index, anchor in enumerate(column):
        if index == 0:
            top = max(0, anchor["y1"] - 24)
        else:
            top = boundaries[index - 1] + 1

        if index < len(boundaries):
            bottom = boundaries[index]
        else:
            search_y1 = min(
                page_height - 1,
                anchor["y2"] + 22,
            )
            search_y2 = min(
                page_height,
                anchor["cy"] + int(typical_pitch * 0.95),
            )

            if search_y2 > search_y1 + 8:
                bottom = find_whitespace_boundary(
                    gray,
                    x1,
                    x2,
                    search_y1,
                    search_y2,
                )
            else:
                bottom = min(
                    page_height,
                    anchor["y2"] + 70,
                )

        minimum_bottom = min(
            page_height,
            anchor["y2"] + 38,
        )
        bottom = max(bottom, minimum_bottom)

        if bottom <= top:
            bottom = min(
                page_height,
                top + max(85, anchor["height"] + 48),
            )

        bands.append((top, bottom))

    return bands


def main() -> None:
    for required_path, label in (
        (IMAGE_PATH, "Prescription"),
        (DETECTION_MODEL_DIR, "Detection model"),
        (RECOGNITION_MODEL_DIR, "Recognition model"),
    ):
        if not required_path.exists():
            raise FileNotFoundError(f"{label} not found: {required_path}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Loading local PaddleOCR models...")

    ocr = PaddleOCR(
        text_detection_model_name="PP-OCRv5_mobile_det",
        text_detection_model_dir=str(DETECTION_MODEL_DIR),
        text_recognition_model_name="PP-OCRv5_mobile_rec",
        text_recognition_model_dir=str(RECOGNITION_MODEL_DIR),
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        device="gpu:0",
    )

    print("Reading prescription...")

    results = ocr.predict(str(IMAGE_PATH))

    if not results:
        raise RuntimeError("PaddleOCR returned no result.")

    payload = read_result(results[0])

    texts = list(payload.get("rec_texts", []))
    scores = list(payload.get("rec_scores", []))
    boxes = list(payload.get("rec_boxes", []))

    image = Image.open(IMAGE_PATH).convert("RGB")
    gray = np.asarray(image.convert("L"))
    page_width, page_height = image.size

    candidates: list[dict] = []

    for text, score, box in zip(texts, scores, boxes):
        clean_text = str(text).strip()

        if not is_probable_medicine_row(clean_text):
            continue

        x1, y1, x2, y2 = [int(value) for value in box]

        candidates.append(
            {
                "text": clean_text,
                "confidence": float(score),
                "x1": x1,
                "y1": y1,
                "x2": x2,
                "y2": y2,
                "cy": (y1 + y2) / 2,
                "height": max(1, y2 - y1),
            }
        )

    if not candidates:
        raise RuntimeError("No probable medicine rows were detected.")

    columns = group_into_columns(candidates, page_width)

    split_points: list[int] = []

    for index in range(len(columns) - 1):
        left_group = columns[index]
        right_group = columns[index + 1]

        left_edge = max(item["x2"] for item in left_group)
        right_edge = min(item["x1"] for item in right_group)

        split_points.append(int((left_edge + right_edge) / 2))

    rows: list[dict] = []

    for column_index, column in enumerate(columns):
        if column_index == 0:
            column_x1 = max(0, min(item["x1"] for item in column) - 45)
        else:
            column_x1 = max(0, split_points[column_index - 1] - 6)

        if column_index < len(split_points):
            column_x2 = min(page_width, split_points[column_index] + 6)
        else:
            column_x2 = page_width - 8

        bands = build_column_boundaries(
            gray,
            column,
            column_x1,
            column_x2,
            page_height,
        )

        for column_row, (anchor, band) in enumerate(
            zip(column, bands),
            start=1,
        ):
            crop_y1, crop_y2 = band

            crop = image.crop(
                (column_x1, crop_y1, column_x2, crop_y2)
            )

            rows.append(
                {
                    "column": column_index + 1,
                    "column_row": column_row,
                    "ocr_text": anchor["text"],
                    "ocr_confidence": round(anchor["confidence"], 4),
                    "anchor_box": [
                        anchor["x1"],
                        anchor["y1"],
                        anchor["x2"],
                        anchor["y2"],
                    ],
                    "crop_box": [
                        column_x1,
                        crop_y1,
                        column_x2,
                        crop_y2,
                    ],
                    "crop": crop,
                }
            )

    rows.sort(key=lambda row: (row["crop_box"][1], row["crop_box"][0]))

    metadata: list[dict] = []
    contact_parts: list[tuple[str, Image.Image]] = []

    for output_row, row in enumerate(rows, start=1):
        crop_name = f"auto_medicine_row_{output_row}.jpg"
        crop_path = OUTPUT_DIR / crop_name
        row["crop"].save(crop_path, quality=95)

        metadata.append(
            {
                "output_row": output_row,
                "column": row["column"],
                "column_row": row["column_row"],
                "ocr_text": row["ocr_text"],
                "ocr_confidence": row["ocr_confidence"],
                "anchor_box": row["anchor_box"],
                "crop_box": row["crop_box"],
                "crop_file": str(crop_path),
            }
        )

        contact_parts.append((crop_name, row["crop"]))

    metadata_path = OUTPUT_DIR / "auto-row-metadata.json"
    metadata_path.write_text(
        json.dumps(metadata, indent=2),
        encoding="utf-8",
    )

    contact_width = max(crop.width for _, crop in contact_parts)
    contact_height = sum(crop.height + 38 for _, crop in contact_parts)

    contact_sheet = Image.new(
        "RGB",
        (contact_width, contact_height),
        "white",
    )

    draw = ImageDraw.Draw(contact_sheet)
    current_y = 0

    for crop_name, crop in contact_parts:
        draw.text((8, current_y + 8), crop_name, fill="black")
        contact_sheet.paste(crop, (0, current_y + 30))
        current_y += crop.height + 38

    contact_path = OUTPUT_DIR / "auto-row-contact-sheet-v4.jpg"
    contact_sheet.save(contact_path, quality=95)

    print()
    print("AUTOMATIC MEDICINE-ROW DETECTION V4 COMPLETE")
    print("--------------------------------------------")
    print(f"Detected columns: {len(columns)}")
    print(f"Detected rows:    {len(metadata)}")

    for row in metadata:
        print(
            f"Crop {row['output_row']}: "
            f"column {row['column']}, "
            f"row {row['column_row']} | "
            f"{row['ocr_text']}"
        )

    print()
    print(f"Metadata:      {metadata_path}")
    print(f"Contact sheet: {contact_path}")


if __name__ == "__main__":
    main()
