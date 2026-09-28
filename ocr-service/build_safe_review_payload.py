from __future__ import annotations

import json
from pathlib import Path


INPUT_PATH = Path(
    r"C:\Users\tharu\meditrack-ai\ocr-service"
    r"\medicine-row-output-final\qwen-row-results.json"
)

OUTPUT_PATH = INPUT_PATH.parent / "safe-review-payload.json"


def normalize_nullable(value):
    if value in ("", [], {}):
        return None
    return value


def main() -> None:
    if not INPUT_PATH.exists():
        raise FileNotFoundError(f"Input not found: {INPUT_PATH}")

    source_rows = json.loads(INPUT_PATH.read_text(encoding="utf-8"))
    review_rows = []

    for source in source_rows:
        extracted = source.get("extracted") or {}
        uncertain_fields = list(extracted.get("uncertain_fields") or [])

        medicine_raw = normalize_nullable(extracted.get("medicine_raw"))
        formulation_suffix = normalize_nullable(
            extracted.get("formulation_suffix")
        )
        strength = normalize_nullable(extracted.get("strength"))
        quantity = normalize_nullable(extracted.get("quantity"))
        schedule_raw = normalize_nullable(extracted.get("schedule_raw"))
        exact_time = normalize_nullable(extracted.get("exact_time"))
        food_timing = normalize_nullable(extracted.get("food_timing"))

        # Medical-safety rule:
        # Nothing is auto-confirmed from OCR/vision alone.
        review_required = True

        field_status = {
            "medicine_raw": (
                "uncertain"
                if "medicine_raw" in uncertain_fields or not medicine_raw
                else "candidate"
            ),
            "formulation_suffix": (
                "uncertain"
                if "formulation_suffix" in uncertain_fields
                else ("candidate" if formulation_suffix else "absent")
            ),
            "strength": (
                "uncertain"
                if "strength" in uncertain_fields
                else ("candidate" if strength else "absent")
            ),
            "quantity": (
                "uncertain"
                if "quantity" in uncertain_fields
                else ("candidate" if quantity else "absent")
            ),
            "schedule_raw": (
                "uncertain"
                if "schedule_raw" in uncertain_fields
                else ("candidate" if schedule_raw else "absent")
            ),
            "exact_time": (
                "uncertain"
                if "exact_time" in uncertain_fields
                else ("candidate" if exact_time else "absent")
            ),
            "food_timing": (
                "uncertain"
                if "food_timing" in uncertain_fields
                else ("candidate" if food_timing else "absent")
            ),
        }

        readable_candidate = (
            medicine_raw is not None
            and field_status["medicine_raw"] == "candidate"
        )

        review_rows.append(
            {
                "row": source.get("output_row"),
                "column": source.get("column"),
                "ocr_anchor_text": source.get("ocr_anchor_text"),
                "ocr_confidence": source.get("ocr_confidence"),
                "medicine": {
                    "line_number": normalize_nullable(
                        extracted.get("line_number")
                    ),
                    "dosage_form": normalize_nullable(
                        extracted.get("dosage_form")
                    ),
                    "medicine_raw": medicine_raw,
                    "formulation_suffix": formulation_suffix,
                    "strength": strength,
                    "quantity": quantity,
                    "schedule_raw": schedule_raw,
                    "morning": normalize_nullable(
                        extracted.get("morning")
                    ),
                    "afternoon": normalize_nullable(
                        extracted.get("afternoon")
                    ),
                    "evening": normalize_nullable(
                        extracted.get("evening")
                    ),
                    "exact_time": exact_time,
                    "food_timing": food_timing,
                },
                "field_status": field_status,
                "readable_candidate": readable_candidate,
                "review_required": review_required,
                "uncertain_fields": uncertain_fields,
                "evidence": {
                    "name_image": source.get("name_file"),
                    "context_image": source.get("context_file"),
                },
            }
        )

    payload = {
        "status": "human_review_required",
        "auto_confirmed_count": 0,
        "row_count": len(review_rows),
        "rows": review_rows,
    }

    OUTPUT_PATH.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    print("Safe review payload created.")
    print(f"Rows:   {len(review_rows)}")
    print(f"Output: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
