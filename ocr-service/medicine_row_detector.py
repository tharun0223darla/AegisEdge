from __future__ import annotations

import json
import re
import shutil
import statistics
from pathlib import Path

from PIL import Image, ImageDraw
from paddleocr import PaddleOCR


# ============================================================
# CONFIGURATION
# ============================================================

IMAGE_PATH = Path(
    r"C:\Users\tharu\meditrack-ai\uploads\prescriptions"
    r"\15996936-6a79-4433-9fcf-7512d875f606.jpeg"
)

OUTPUT_DIR = Path(
    r"C:\Users\tharu\meditrack-ai\ocr-service"
    r"\medicine-row-output"
)

DETECTION_MODEL_DIR = Path(
    r"C:\Users\tharu\.paddlex\official_models"
    r"\PP-OCRv5_mobile_det"
)

RECOGNITION_MODEL_DIR = Path(
    r"C:\Users\tharu\.paddlex\official_models"
    r"\PP-OCRv5_mobile_rec"
)


# ============================================================
# MEDICINE-ROW FILTERS
# ============================================================

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

    if not clean:
        return False

    if EXCLUDED_PATTERN.search(clean):
        return False

    has_dosage_form = bool(DOSAGE_FORM_PATTERN.search(clean))
    has_row_number = bool(NUMBERED_ROW_PATTERN.search(clean))
    has_letters = len(re.findall(r"[A-Za-z]", clean)) >= 4

    return has_dosage_form or (has_row_number and has_letters)


def read_paddle_result(result) -> dict:
    data = result.json

    if isinstance(data, str):
        data = json.loads(data)

    return data.get("res", data)


# ============================================================
# COLUMN AND DUPLICATE HANDLING
# ============================================================

def remove_duplicate_anchors(
    candidates: list[dict],
    page_height: int,
) -> list[dict]:
    """
    Keep the strongest OCR anchor when two candidates refer to the same row.
    """
    if not candidates:
        return []

    tolerance = max(16, int(page_height * 0.018))
    kept: list[dict] = []

    for candidate in sorted(
        candidates,
        key=lambda item: (-item["confidence"], item["cy"]),
    ):
        duplicate = False

        for existing in kept:
            same_vertical_band = abs(candidate["cy"] - existing["cy"]) <= tolerance
            similar_column = abs(candidate["cx"] - existing["cx"]) <= 220

            if same_vertical_band and similar_column:
                duplicate = True
                break

        if not duplicate:
            kept.append(candidate)

    return sorted(kept, key=lambda item: (item["cy"], item["x1"]))


def group_into_columns(
    candidates: list[dict],
    page_width: int,
) -> list[list[dict]]:
    """
    Group medicine anchors into separate prescription columns.
    """
    groups: list[list[dict]] = []
    threshold = page_width * 0.19

    for candidate in sorted(candidates, key=lambda item: item["cx"]):
        selected_group = None
        selected_distance = float("inf")

        for group in groups:
            mean_x = statistics.mean(item["cx"] for item in group)
            distance = abs(candidate["cx"] - mean_x)

            if distance <= threshold and distance < selected_distance:
                selected_group = group
                selected_distance = distance

        if selected_group is None:
            groups.append([candidate])
        else:
            selected_group.append(candidate)

    groups.sort(
        key=lambda group: statistics.mean(item["cx"] for item in group)
    )

    for group in groups:
        group.sort(key=lambda item: item["cy"])

    return groups


def calculate_column_ranges(
    columns: list[list[dict]],
    page_width: int,
) -> list[tuple[int, int]]:
    """
    Create non-overlapping horizontal ranges for each detected column.
    """
    if len(columns) == 1:
        return [(0, page_width)]

    centres = [
        statistics.mean(item["cx"] for item in column)
        for column in columns
    ]

    split_points = [
        int((centres[index] + centres[index + 1]) / 2)
        for index in range(len(centres) - 1)
    ]

    ranges: list[tuple[int, int]] = []

    for index in range(len(columns)):
        left = 0 if index == 0 else split_points[index - 1]
        right = page_width if index == len(columns) - 1 else split_points[index]

        ranges.append((left, right))

    return ranges


# ============================================================
# CROP CREATION
# ============================================================

def typical_row_pitch(
    column: list[dict],
    page_height: int,
) -> int:
    gaps = [
        int(column[index + 1]["cy"] - column[index]["cy"])
        for index in range(len(column) - 1)
        if column[index + 1]["cy"] > column[index]["cy"]
    ]

    if gaps:
        pitch = int(statistics.median(gaps))
    else:
        pitch = int(page_height * 0.085)

    return max(
        int(page_height * 0.055),
        min(pitch, int(page_height * 0.13)),
    )


def build_row_crops(
    image: Image.Image,
    column: list[dict],
    column_x1: int,
    column_x2: int,
    page_height: int,
) -> list[dict]:
    """
    Produce three crops per medicine:

    1. name_crop:
       Tight medicine-name row only. Best for PaddleOCR and TrOCR.

    2. instruction_crop:
       Area below the name until before the next medicine name.

    3. combined_crop:
       Name + dosage marks, but never the next medicine name.

    This avoids forcing one oversized crop to perform two different jobs.
    """
    pitch = typical_row_pitch(column, page_height)
    results: list[dict] = []

    for index, anchor in enumerate(column):
        row_height = anchor["height"]

        name_top = max(
            0,
            int(anchor["y1"] - max(10, row_height * 0.35)),
        )

        name_bottom = min(
            page_height,
            int(anchor["y2"] + max(12, row_height * 0.40)),
        )

        if index + 1 < len(column):
            next_anchor = column[index + 1]

            next_name_limit = max(
                name_bottom,
                int(next_anchor["y1"] - max(8, pitch * 0.08)),
            )

            combined_bottom = min(
                next_name_limit,
                int(name_bottom + pitch * 0.72),
            )
        else:
            combined_bottom = min(
                page_height,
                int(name_bottom + pitch * 0.68),
            )

        combined_bottom = max(
            name_bottom,
            combined_bottom,
        )

        instruction_top = min(
            combined_bottom,
            name_bottom,
        )

        instruction_bottom = combined_bottom

        # Add modest horizontal padding inside this column only.
        crop_x1 = max(
            column_x1,
            int(anchor["x1"] - 35),
        )

        crop_x2 = column_x2

        name_crop = image.crop(
            (crop_x1, name_top, crop_x2, name_bottom)
        )

        combined_crop = image.crop(
            (crop_x1, name_top, crop_x2, combined_bottom)
        )

        instruction_crop = None

        if instruction_bottom - instruction_top >= 18:
            instruction_crop = image.crop(
                (
                    crop_x1,
                    instruction_top,
                    crop_x2,
                    instruction_bottom,
                )
            )

        results.append(
            {
                "anchor": anchor,
                "name_box": [
                    crop_x1,
                    name_top,
                    crop_x2,
                    name_bottom,
                ],
                "instruction_box": [
                    crop_x1,
                    instruction_top,
                    crop_x2,
                    instruction_bottom,
                ],
                "combined_box": [
                    crop_x1,
                    name_top,
                    crop_x2,
                    combined_bottom,
                ],
                "name_crop": name_crop,
                "instruction_crop": instruction_crop,
                "combined_crop": combined_crop,
            }
        )

    return results


# ============================================================
# CONTACT SHEET
# ============================================================

def create_contact_sheet(
    rows: list[dict],
    output_path: Path,
) -> None:
    labelled_images: list[tuple[str, Image.Image]] = []

    for row in rows:
        labelled_images.append(
            (
                f"Row {row['output_row']} - NAME",
                row["name_crop"],
            )
        )
        labelled_images.append(
            (
                f"Row {row['output_row']} - COMBINED",
                row["combined_crop"],
            )
        )

    width = max(image.width for _, image in labelled_images)
    height = sum(image.height + 34 for _, image in labelled_images)

    sheet = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(sheet)

    current_y = 0

    for label, image in labelled_images:
        draw.text((8, current_y + 7), label, fill="black")
        sheet.paste(image, (0, current_y + 26))
        current_y += image.height + 34

    sheet.save(output_path, quality=95)


# ============================================================
# MAIN
# ============================================================

def main() -> None:
    required_paths = (
        (IMAGE_PATH, "Prescription"),
        (DETECTION_MODEL_DIR, "Detection model"),
        (RECOGNITION_MODEL_DIR, "Recognition model"),
    )

    for required_path, label in required_paths:
        if not required_path.exists():
            raise FileNotFoundError(
                f"{label} not found: {required_path}"
            )

    # Always replace the previous output.
    # Running this script will not create endless version folders.
    if OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)

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

    payload = read_paddle_result(results[0])

    texts = list(payload.get("rec_texts", []))
    scores = list(payload.get("rec_scores", []))
    boxes = list(payload.get("rec_boxes", []))

    if not texts or not boxes:
        raise RuntimeError("No OCR text boxes were detected.")

    image = Image.open(IMAGE_PATH).convert("RGB")
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
                "cx": (x1 + x2) / 2,
                "cy": (y1 + y2) / 2,
                "height": max(1, y2 - y1),
            }
        )

    candidates = remove_duplicate_anchors(
        candidates,
        page_height,
    )

    if not candidates:
        raise RuntimeError(
            "No probable medicine rows were detected."
        )

    columns = group_into_columns(
        candidates,
        page_width,
    )

    column_ranges = calculate_column_ranges(
        columns,
        page_width,
    )

    detected_rows: list[dict] = []

    for column_index, (column, horizontal_range) in enumerate(
        zip(columns, column_ranges),
        start=1,
    ):
        column_x1, column_x2 = horizontal_range

        column_rows = build_row_crops(
            image=image,
            column=column,
            column_x1=column_x1,
            column_x2=column_x2,
            page_height=page_height,
        )

        for column_row, row in enumerate(column_rows, start=1):
            row["column"] = column_index
            row["column_row"] = column_row
            detected_rows.append(row)

    detected_rows.sort(
        key=lambda row: (
            row["combined_box"][1],
            row["combined_box"][0],
        )
    )

    metadata: list[dict] = []

    for output_row, row in enumerate(detected_rows, start=1):
        row_dir = OUTPUT_DIR / f"row_{output_row:02d}"
        row_dir.mkdir(parents=True, exist_ok=True)

        name_path = row_dir / "name.jpg"
        combined_path = row_dir / "combined.jpg"
        instruction_path = row_dir / "instruction.jpg"

        row["name_crop"].save(name_path, quality=95)
        row["combined_crop"].save(combined_path, quality=95)

        if row["instruction_crop"] is not None:
            row["instruction_crop"].save(
                instruction_path,
                quality=95,
            )
            instruction_file = str(instruction_path)
        else:
            instruction_file = None

        row["output_row"] = output_row

        metadata.append(
            {
                "output_row": output_row,
                "column": row["column"],
                "column_row": row["column_row"],
                "ocr_anchor_text": row["anchor"]["text"],
                "ocr_confidence": round(
                    row["anchor"]["confidence"],
                    4,
                ),
                "anchor_box": [
                    row["anchor"]["x1"],
                    row["anchor"]["y1"],
                    row["anchor"]["x2"],
                    row["anchor"]["y2"],
                ],
                "name_box": row["name_box"],
                "instruction_box": row["instruction_box"],
                "combined_box": row["combined_box"],
                "name_file": str(name_path),
                "instruction_file": instruction_file,
                "combined_file": str(combined_path),
            }
        )

    metadata_path = OUTPUT_DIR / "metadata.json"
    metadata_path.write_text(
        json.dumps(metadata, indent=2),
        encoding="utf-8",
    )

    contact_path = OUTPUT_DIR / "contact-sheet.jpg"
    create_contact_sheet(
        detected_rows,
        contact_path,
    )

    print()
    print("MEDICINE ROW DETECTION COMPLETE")
    print("-------------------------------")
    print(f"Detected columns: {len(columns)}")
    print(f"Detected rows:    {len(metadata)}")
    print()

    for row in metadata:
        print(
            f"Row {row['output_row']}: "
            f"column={row['column']} "
            f"anchor={row['ocr_anchor_text']!r}"
        )

    print()
    print(f"Output directory: {OUTPUT_DIR}")
    print(f"Metadata:         {metadata_path}")
    print(f"Contact sheet:    {contact_path}")


if __name__ == "__main__":
    main()
