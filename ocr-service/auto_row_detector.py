from __future__ import annotations

import json
import re
from pathlib import Path

from PIL import Image, ImageDraw
from paddleocr import PaddleOCR


# --------------------------------------------------
# PATHS
# --------------------------------------------------

IMAGE_PATH = Path(
    r"C:\Users\tharu\meditrack-ai\uploads\prescriptions"
    r"\15996936-6a79-4433-9fcf-7512d875f606.jpeg"
)

OUTPUT_DIR = Path(
    r"C:\Users\tharu\meditrack-ai\ocr-service\auto-row-crops"
)

DETECTION_MODEL_DIR = Path(
    r"C:\Users\tharu\.paddlex\official_models"
    r"\PP-OCRv5_mobile_det"
)

RECOGNITION_MODEL_DIR = Path(
    r"C:\Users\tharu\.paddlex\official_models"
    r"\PP-OCRv5_mobile_rec"
)


# --------------------------------------------------
# MEDICINE-ROW RULES
# --------------------------------------------------

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
    """Return True only for text that looks like a prescription medicine row."""
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
    """Convert PaddleOCR result object into a normal dictionary."""
    data = result.json

    if isinstance(data, str):
        data = json.loads(data)

    return data.get("res", data)


def main() -> None:
    if not IMAGE_PATH.exists():
        raise FileNotFoundError(f"Prescription not found: {IMAGE_PATH}")

    if not DETECTION_MODEL_DIR.exists():
        raise FileNotFoundError(
            f"Detection model not found: {DETECTION_MODEL_DIR}"
        )

    if not RECOGNITION_MODEL_DIR.exists():
        raise FileNotFoundError(
            f"Recognition model not found: {RECOGNITION_MODEL_DIR}"
        )

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

    candidates = []

    for text, score, box in zip(texts, scores, boxes):
        text = str(text).strip()

        if not is_probable_medicine_row(text):
            continue

        x1, y1, x2, y2 = [int(value) for value in box]

        candidates.append(
            {
                "text": text,
                "confidence": float(score),
                "box": [x1, y1, x2, y2],
            }
        )

    candidates.sort(key=lambda item: (item["box"][1], item["box"][0]))

    if not candidates:
        raise RuntimeError("No probable medicine rows were detected.")

    metadata = []
    contact_parts = []

    for index, candidate in enumerate(candidates, start=1):
        x1, y1, x2, y2 = candidate["box"]

        # Expand around the detected medicine text.
        # This is dynamic and does not use prescription-specific coordinates.
        crop_x1 = max(0, x1 - 35)
        crop_x2 = min(page_width, max(x2 + 220, int(page_width * 0.94)))
        crop_y1 = max(0, y1 - 18)
        crop_y2 = min(page_height, y2 + 75)

        crop = image.crop((crop_x1, crop_y1, crop_x2, crop_y2))

        crop_name = f"auto_medicine_row_{index}.jpg"
        crop_path = OUTPUT_DIR / crop_name
        crop.save(crop_path, quality=95)

        metadata.append(
            {
                "row": index,
                "ocr_text": candidate["text"],
                "ocr_confidence": round(candidate["confidence"], 4),
                "detected_box": candidate["box"],
                "crop_box": [crop_x1, crop_y1, crop_x2, crop_y2],
                "crop_file": str(crop_path),
            }
        )

        contact_parts.append((crop_name, crop))

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

    contact_path = OUTPUT_DIR / "auto-row-contact-sheet.jpg"
    contact_sheet.save(contact_path, quality=95)

    print()
    print("AUTOMATIC MEDICINE-ROW DETECTION COMPLETE")
    print("-----------------------------------------")
    print(f"Detected rows: {len(metadata)}")

    for row in metadata:
        print(
            f"Row {row['row']}: "
            f"{row['ocr_text']} "
            f"(confidence {row['ocr_confidence']})"
        )

    print()
    print(f"Metadata:      {metadata_path}")
    print(f"Contact sheet: {contact_path}")


if __name__ == "__main__":
    main()
