from __future__ import annotations

import json
import re
import statistics
from pathlib import Path

from PIL import Image, ImageDraw
from paddleocr import PaddleOCR


IMAGE_PATH = Path(
    r"C:\Users\tharu\meditrack-ai\uploads\prescriptions"
    r"\15996936-6a79-4433-9fcf-7512d875f606.jpeg"
)

OUTPUT_DIR = Path(
    r"C:\Users\tharu\meditrack-ai\ocr-service\auto-row-crops-v2"
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
    """Group medicine anchors into separate left/right prescription columns."""
    groups: list[list[dict]] = []
    threshold = page_width * 0.18

    for candidate in sorted(candidates, key=lambda item: item["x1"]):
        best_group = None
        best_distance = float("inf")

        for group in groups:
            mean_x = statistics.mean(item["x1"] for item in group)
            distance = abs(candidate["x1"] - mean_x)

            if distance <= threshold and distance < best_distance:
                best_group = group
                best_distance = distance

        if best_group is None:
            groups.append([candidate])
        else:
            best_group.append(candidate)

    groups.sort(
        key=lambda group: statistics.mean(item["x1"] for item in group)
    )

    for group in groups:
        group.sort(key=lambda item: item["y1"])

    return groups


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
                "height": max(1, y2 - y1),
            }
        )

    if not candidates:
        raise RuntimeError("No probable medicine rows were detected.")

    columns = group_into_columns(candidates, page_width)

    # Calculate horizontal split points between neighboring columns.
    split_points: list[int] = []

    for index in range(len(columns) - 1):
        left_group = columns[index]
        right_group = columns[index + 1]

        left_edge = max(item["x2"] for item in left_group)
        right_edge = min(item["x1"] for item in right_group)

        split_points.append(int((left_edge + right_edge) / 2))

    rows: list[dict] = []
    crop_parts: list[tuple[str, Image.Image]] = []

    for column_index, column in enumerate(columns):
        if column_index == 0:
            column_x1 = max(0, min(item["x1"] for item in column) - 40)
        else:
            column_x1 = max(0, split_points[column_index - 1] - 10)

        if column_index < len(split_points):
            column_x2 = min(page_width, split_points[column_index] + 10)
        else:
            column_x2 = page_width - 10

        vertical_gaps = [
            column[index + 1]["y1"] - column[index]["y1"]
            for index in range(len(column) - 1)
            if column[index + 1]["y1"] > column[index]["y1"]
        ]

        if vertical_gaps:
            fallback_height = int(statistics.median(vertical_gaps))
        else:
            fallback_height = int(page_height * 0.08)

        fallback_height = max(
            int(page_height * 0.07),
            min(fallback_height, int(page_height * 0.12)),
        )

        for row_index, anchor in enumerate(column):
            crop_y1 = max(0, anchor["y1"] - 18)

            if row_index + 1 < len(column):
                next_anchor = column[row_index + 1]
                crop_y2 = max(
                    anchor["y2"] + 45,
                    next_anchor["y1"] - 10,
                )
                crop_y2 = min(crop_y2, next_anchor["y1"] - 4)
            else:
                crop_y2 = min(
                    page_height,
                    max(
                        anchor["y2"] + 75,
                        anchor["y1"] + fallback_height,
                    ),
                )

            if crop_y2 <= crop_y1:
                crop_y2 = min(page_height, crop_y1 + 110)

            crop = image.crop(
                (column_x1, crop_y1, column_x2, crop_y2)
            )

            rows.append(
                {
                    "column": column_index + 1,
                    "column_row": row_index + 1,
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

    # Save in visual page order while keeping column information in metadata.
    rows.sort(key=lambda row: (row["crop_box"][1], row["crop_box"][0]))

    metadata: list[dict] = []

    for output_index, row in enumerate(rows, start=1):
        crop_name = f"auto_medicine_row_{output_index}.jpg"
        crop_path = OUTPUT_DIR / crop_name
        row["crop"].save(crop_path, quality=95)

        metadata.append(
            {
                "output_row": output_index,
                "column": row["column"],
                "column_row": row["column_row"],
                "ocr_text": row["ocr_text"],
                "ocr_confidence": row["ocr_confidence"],
                "anchor_box": row["anchor_box"],
                "crop_box": row["crop_box"],
                "crop_file": str(crop_path),
            }
        )

        crop_parts.append((crop_name, row["crop"]))

    metadata_path = OUTPUT_DIR / "auto-row-metadata.json"
    metadata_path.write_text(
        json.dumps(metadata, indent=2),
        encoding="utf-8",
    )

    contact_width = max(crop.width for _, crop in crop_parts)
    contact_height = sum(crop.height + 38 for _, crop in crop_parts)

    contact_sheet = Image.new(
        "RGB",
        (contact_width, contact_height),
        "white",
    )

    draw = ImageDraw.Draw(contact_sheet)
    current_y = 0

    for crop_name, crop in crop_parts:
        draw.text((8, current_y + 8), crop_name, fill="black")
        contact_sheet.paste(crop, (0, current_y + 30))
        current_y += crop.height + 38

    contact_path = OUTPUT_DIR / "auto-row-contact-sheet-v2.jpg"
    contact_sheet.save(contact_path, quality=95)

    print()
    print("AUTOMATIC MEDICINE-ROW DETECTION V2 COMPLETE")
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
