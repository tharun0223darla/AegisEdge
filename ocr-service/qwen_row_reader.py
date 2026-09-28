from __future__ import annotations

import argparse
import base64
import json
import re
import statistics
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps


DEFAULT_IMAGE = Path(
    r"C:\Users\tharu\meditrack-ai\uploads\prescriptions"
    r"\15996936-6a79-4433-9fcf-7512d875f606.jpeg"
)

DEFAULT_METADATA = Path(
    r"C:\Users\tharu\meditrack-ai\ocr-service"
    r"\medicine-row-output-final\metadata.json"
)

DEFAULT_MODEL = "qwen3-vl:2b-instruct"
OLLAMA_URL = "http://localhost:11434/api/chat"

DOSAGE_PREFIX_PATTERN = re.compile(
    r"^\s*(?:"
    r"(?:r\s*x|rx|kp|r[\.:)]?\s+)\s*"
    r"|(?:[\(\[]?\d+[\)\].:-]?\s*)"
    r"|(?:(?:tab|tabs|tablet|tb|tub|pub|pul|cub|pat|pal|tal|cap|capsule|"
    r"syp|symp|syr|syrup|inj|injection|cream|ointment|"
    r"gel|drops?|nebulization(?:\s+with)?|neb)\.?\s*)"
    r")+",
    re.IGNORECASE,
)

STRENGTH_PATTERN = re.compile(
    r"\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|iu|%)\b",
    re.IGNORECASE,
)

SCHEDULE_PATTERN = re.compile(
    r"\b\d+\s*\+\s*(?:\d+|o|O|D|d)"
)

TRAILING_BARE_STRENGTH_PATTERN = re.compile(
    r"\s+(?:\d{2,4}(?:\.\d+)?|\d+\.\d+)\s*$"
)

TRAILING_DOSING_PATTERN = re.compile(
    r"(?:\s*(?:[?—-]|â€”)\s*(?:0|o|O|\d)\s*(?:to|\+).*"
    r"|\s*-\s*[0oO]\s*\+.*|-[0oO]\+.*)$",
    re.IGNORECASE,
)

TRAILING_LEGACY_DOSING_PATTERN = re.compile(
    r"\s+(?:grs?\.?|gtt\.?|minims?|m\.?|ad)\s*"
    r"(?:[ivxlcdm]+|[a-z]{1,6}|\d+(?:/\d+)?|[#.,-])"
    r"(?:\s*(?:[ivxlcdm]+|[a-z]{1,6}|\d+(?:/\d+)?|[#.,-]))*\s*$",
    re.IGNORECASE,
)

TRAILING_APOTHECARY_FRAGMENT_PATTERN = re.compile(
    r"\s+(?:"
    r"\d+(?:/\d+)?[a-z]*"
    r"|[md]\.?\s+[a-z]{1,6}"
    r"|[ivxlcdm]{1,8}"
    r")\s*$",
    re.IGNORECASE,
)

LEGACY_COMPOUND_START_PATTERN = re.compile(
    r"\b(?:cocaine|adrenalin(?:e)?|saline\s+sol(?:ution)?|saline)\b",
    re.IGNORECASE,
)

NON_MEDICINE_NAME_PATTERN = re.compile(
    r"\b("
    r"knee\s*cap|knee\s*brace|brace|support|belt|collar|"
    r"physio(?:therapy)?|exercise|exercises|rehab|"
    r"hot\s+fomentation|ice\s+pack|rest|advice|advise|"
    r"lifestyle|walking|walk|splint|"
    r"low\s+salt|diet|review|follow\s*up|"
    r"x[\s-]?ray|spine|ap\s*/?\s*lat|fbs|ppbs|"
    r"cbc|lft|lab|report|echo|bp\s*chart|chart|"
    r"patient|pt\.?|ient|age|years?|yrs?|y/o|yo|old|"
    r"male|female|sex|gender|wt\.?|weight|kg|cm|"
    r"bp|blood\s+pressure|temp(?:erature)?|spo2|"
    r"pulse|hr|rr|bpm|vitals?|"
    r"ecg|ekg|lvef|ejection\s+fraction|"
    r"visible|diagnos(?:is|tic)|provisional|symptoms?|"
    r"complaints?|history|functional\s+dyspepsia|dyspepsia|"
    r"abdominal?|abdomen|pain|vomit(?:ing)?|fever|cold|cough|"
    r"alcohol|tobacco|cardiac\s+evaluation|consultation|"
    r"glycemic\s+control|lymph\s+node|malignancy|"
    r"before\s+meals?|after\s+meals?|meals?|"
    r"precautions?|mask|avoid\s+(?:crowd|grapefruit)|"
    r"no\s+pregnancy|pregnancy|oxygen\s+concentrator|"
    r"steam|inhalation|"
    r"sig\.?|signa|locally|local\s+application|"
    r"m\.?\s*d\.?|doctor|dr\.?|physician|prescriber|"
    r"signature|office|licen[cs]e|reg(?:istration)?"
    r")\b",
    re.IGNORECASE,
)

INITIAL_SURNAME_PATTERN = re.compile(
    r"^\s*[a-z]{1,2}\.\s+[a-z][a-z'-]{3,}\.?\s*$",
    re.IGNORECASE,
)

MULTI_INITIAL_SURNAME_PATTERN = re.compile(
    r"^\s*(?:[a-z]\.\s*){2,}[a-z][a-z'-]{3,}\.?\s*$",
    re.IGNORECASE,
)

PATIENT_NAME_PREFIX_PATTERN = re.compile(
    r"^\s*(?:mr|mrs|ms|miss)\.?\s+[a-z][a-z'.-]*(?:\s+[a-z][a-z'.-]*)*",
    re.IGNORECASE,
)

SUSPICIOUS_TRANSCRIPTION_PATTERN = re.compile(
    r"\b(?:b|r|p)?oo?g(?:h|n)?t\b|\b(?:booght|rooght|booghr)\b",
    re.IGNORECASE,
)

DOSAGE_ONLY_PATTERN = re.compile(
    r"^\s*(?:\d+(?:\.\d+)?\s*)?"
    r"(?:ml|mg|mcg|g|iu|tid|bid|od|bd|sos|qid|prn|"
    r"x\s*\d+d?|days?)"
    r"(?:[\s/+-]+(?:ml|mg|mcg|g|iu|tid|bid|od|bd|sos|qid|prn|"
    r"x\s*\d+d?|days?))*\s*$",
    re.IGNORECASE,
)

DOSAGE_INSTRUCTION_ONLY_PATTERN = re.compile(
    r"^\s*(?:i|1|one)\s+tabs?(?:let)?s?\.?\s*$",
    re.IGNORECASE,
)

DURATION_OR_SIG_ONLY_PATTERN = re.compile(
    r"^\s*(?:"
    r"x\s*\d+\s*(?:d|days?|weeks?)"
    r"|(?:s|5)[il1]g\s*:?.*"
    r"|.*\bfor\s+\d+\s*days?\b"
    r")\s*$",
    re.IGNORECASE,
)

NULL_LIKE_TEXT_PATTERN = re.compile(
    r"^\s*(?:null|none|unknown|unreadable|not\s+visible|"
    r"not\s+readable|n/?a|nil|no\s+medicine)\s*$",
    re.IGNORECASE,
)


def encode_image(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


def parse_json_content(content: str):
    text = content.strip()

    if text.startswith("```"):
        lines = text.splitlines()

        if lines and lines[0].lstrip().startswith("```"):
            lines = lines[1:]

        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]

        text = "\n".join(lines).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    candidates = []

    for opener, closer in (("{", "}"), ("[", "]")):
        start = text.find(opener)
        end = text.rfind(closer)

        if start != -1 and end > start:
            candidates.append(text[start : end + 1])

    for candidate in candidates:
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue

    raise json.JSONDecodeError(
        "No JSON object or array found",
        content,
        0,
    )


def clean_medicine_name(value: str) -> str:
    text = value.strip()

    if NULL_LIKE_TEXT_PATTERN.match(text):
        return ""

    previous = None

    while previous != text:
        previous = text
        text = DOSAGE_PREFIX_PATTERN.sub("", text).strip()

    cut_positions = []

    for pattern in (STRENGTH_PATTERN, SCHEDULE_PATTERN):
        match = pattern.search(text)

        if match and match.start() > 0:
            cut_positions.append(match.start())

    if cut_positions:
        text = text[: min(cut_positions)]

    text = TRAILING_DOSING_PATTERN.sub("", text)
    text = TRAILING_LEGACY_DOSING_PATTERN.sub("", text)
    text = TRAILING_APOTHECARY_FRAGMENT_PATTERN.sub("", text)
    text = TRAILING_BARE_STRENGTH_PATTERN.sub("", text)
    text = re.sub(r"\s+", " ", text)
    text = text.strip(" \t\r\n-:,;.")

    if NULL_LIKE_TEXT_PATTERN.match(text):
        return ""

    return text


def classify_non_medicine_name(value: str) -> str | None:
    text = value.strip().lower()

    if not text:
        return "blank"

    if NON_MEDICINE_NAME_PATTERN.search(text):
        if any(
            keyword in text
            for keyword in (
                "sig",
                "signa",
                "locally",
                "m.d",
                " md",
                "doctor",
                "dr.",
                "physician",
                "prescriber",
                "signature",
                "office",
                "license",
                "licence",
                "registration",
            )
        ):
            return "signature"

        if any(
            keyword in text
            for keyword in (
                "knee cap",
                "brace",
                "support",
                "belt",
                "collar",
                "splint",
                "mask",
                "oxygen concentrator",
            )
        ):
            return "device"

        if any(
            keyword in text
            for keyword in ("physio", "exercise", "rehab", "walking", "walk")
        ):
            return "exercise"

        return "advice"

    if PATIENT_NAME_PREFIX_PATTERN.match(text):
        return "patient_detail"

    if (
        INITIAL_SURNAME_PATTERN.match(text)
        or MULTI_INITIAL_SURNAME_PATTERN.match(text)
    ):
        return "signature"

    return None


def is_plausible_medicine_name(value: str) -> bool:
    if DOSAGE_ONLY_PATTERN.match(value.strip()):
        return False

    if DOSAGE_INSTRUCTION_ONLY_PATTERN.match(value.strip()):
        return False

    if DURATION_OR_SIG_ONLY_PATTERN.match(value.strip()):
        return False

    alpha_count = len(re.findall(r"[A-Za-z]", value))

    if alpha_count < 4:
        return False

    if classify_non_medicine_name(value):
        return False

    return True


def is_suspicious_medicine_name(value: str) -> bool:
    text = value.strip()

    if not text:
        return False

    if SUSPICIOUS_TRANSCRIPTION_PATTERN.search(text):
        return True

    return False


def canonical_medicine_key(value: str) -> str:
    text = clean_medicine_name(value).lower()
    text = re.sub(r"\bhydrochlor(?:ide|ic)?\b", "hydrochlor", text)
    text = re.sub(r"\bsol(?:ution)?\b", "sol", text)
    return re.sub(r"[^a-z0-9]+", "", text)


def split_medicine_name_candidates(value: str) -> list[str]:
    raw_text = str(value or "").strip()

    if not raw_text:
        return []

    if classify_non_medicine_name(raw_text):
        return []

    matches = list(LEGACY_COMPOUND_START_PATTERN.finditer(raw_text))

    if len(matches) <= 1:
        cleaned = clean_medicine_name(raw_text)
        return [cleaned] if cleaned else []

    candidates: list[str] = []

    for index, match in enumerate(matches):
        start = match.start()
        end = (
            matches[index + 1].start()
            if index + 1 < len(matches)
            else len(raw_text)
        )
        segment = clean_medicine_name(raw_text[start:end])

        if not segment:
            continue

        if classify_non_medicine_name(segment):
            continue

        if is_suspicious_medicine_name(segment):
            continue

        if not is_plausible_medicine_name(segment):
            continue

        key = canonical_medicine_key(segment)

        if key and all(canonical_medicine_key(item) != key for item in candidates):
            candidates.append(segment)

    return candidates


def calculate_global_pitch(rows: list[dict]) -> int:
    gaps: list[int] = []

    by_column: dict[int, list[dict]] = {}

    for row in rows:
        by_column.setdefault(int(row["column"]), []).append(row)

    for column_rows in by_column.values():
        column_rows.sort(key=lambda item: item["crop_box"][1])

        for index in range(len(column_rows) - 1):
            current_top = int(column_rows[index]["crop_box"][1])
            next_top = int(column_rows[index + 1]["crop_box"][1])
            gap = next_top - current_top

            if gap > 0:
                gaps.append(gap)

    return int(statistics.median(gaps)) if gaps else 100


def create_context_crops(
    image_path: Path,
    metadata_path: Path,
) -> list[dict]:
    rows = json.loads(metadata_path.read_text(encoding="utf-8"))

    for row in rows:
        if not isinstance(row, dict):
            continue

        page_file = row.get("page_image_file")

        if not page_file:
            continue

        candidate = Path(str(page_file))

        if candidate.exists():
            image_path = candidate
            break

    image = Image.open(image_path).convert("RGB")
    page_width, page_height = image.size

    global_pitch = calculate_global_pitch(rows)

    by_column: dict[int, list[dict]] = {}

    for row in rows:
        by_column.setdefault(int(row["column"]), []).append(row)

    for column_rows in by_column.values():
        column_rows.sort(key=lambda item: item["crop_box"][1])

        for index, row in enumerate(column_rows):
            x1, y1, x2, y2 = [int(value) for value in row["crop_box"]]
            crop_mode = str(row.get("crop_mode") or "row")

            if crop_mode == "sparse_body":
                context_top = max(0, y1)
                context_bottom = min(page_height, y2)
            elif index + 1 < len(column_rows):
                next_top = int(column_rows[index + 1]["crop_box"][1])
                context_bottom = max(y2, next_top - 4)
                context_top = max(0, y1 - 4)
            else:
                context_bottom = min(
                    page_height,
                    y2 + max(65, int(global_pitch * 0.75)),
                )
                context_top = max(0, y1 - 4)

            context_x1 = max(0, x1)
            context_x2 = min(page_width, x2)

            row_dir = metadata_path.parent / f"row_{int(row['output_row']):02d}"
            row_dir.mkdir(parents=True, exist_ok=True)

            context_path = row_dir / "context.jpg"

            context = image.crop(
                (
                    context_x1,
                    context_top,
                    context_x2,
                    context_bottom,
                )
            )
            context.save(context_path, quality=95)

            row["context_file"] = str(context_path)
            row["context_box"] = [
                context_x1,
                context_top,
                context_x2,
                context_bottom,
            ]

    rows.sort(key=lambda item: int(item["output_row"]))
    return rows


def call_qwen(
    model: str,
    name_path: Path,
    context_path: Path,
    ocr_hint: str,
    timeout_seconds: int = 25,
    num_predict: int = 160,
) -> dict:
    prompt = f"""
You are reading one handwritten prescription medicine row.

Image 1 is a tight medicine-name crop.
Image 2 contains the same name plus instructions written below it.

A PaddleOCR hint is provided, but it may be wrong:
{ocr_hint}

Return JSON only:

{{
  "is_medicine_row": null,
  "row_type": null,
  "line_number": null,
  "dosage_form": null,
  "medicine_raw": null,
  "formulation_suffix": null,
  "strength": null,
  "quantity": null,
  "schedule_raw": null,
  "morning": null,
  "afternoon": null,
  "evening": null,
  "exact_time": null,
  "food_timing": null,
  "uncertain_fields": []
}}

Rules:
- First classify the row.
- Set is_medicine_row=true when the row visibly contains a prescribed medicine name, dosage form, strength, quantity, or medicine schedule.
- Set is_medicine_row=false only when the row is definitely advice, a device, exercise, a heading, or blank.
- When uncertain, use null for is_medicine_row and "other" for row_type.
- row_type must be one of: medicine, advice, device, exercise, signature, blank, other.
- Knee cap, brace, physiotherapy, exercise and lifestyle instructions are not medicines.
- CBC, LFT, lab reports, echo, BP charts, oxygen concentrators, masks, precautions, pregnancy warnings and avoid-instructions are not medicines.
- Headings, signatures, patient details and blank separator rows are not medicines.
- For every non-medicine row, set all medicine fields to null.
- Prescriber names, M.D./doctor/office/license text, and Sig./Signa/local application instruction rows are signature rows, not medicines.
- In old compounded prescriptions, one crop may span several ingredient lines. If so, put all visible ingredient names in medicine_raw and separate them with spaces or semicolons.
- Never classify a row as medicine merely because the word "Cap" is visible.
- Read only what is visibly supported by the images.
- Preserve the visible medicine spelling. Do not autocorrect using medical knowledge.
- Use Image 1 mainly for medicine name, dosage form, strength and quantity.
- Use Image 2 mainly for schedule marks, exact time and food timing.
- A circled number at the far right is usually quantity.
- SR, CR, ER and XR are formulation suffixes, not strengths.
- An uncircled number directly beside the medicine may be strength.
- Do not guess the meaning or position of unclear dosage marks.
- Keep unclear marks in schedule_raw and add the field name to uncertain_fields.
- Use null whenever a value is unreadable or absent.
""".strip()

    payload = {
        "model": model,
        "stream": False,
        "format": "json",
        "keep_alive": "30m",
        "options": {
            "temperature": 0,
            "num_predict": num_predict,
        },
        "messages": [
            {
                "role": "user",
                "content": prompt,
                "images": [
                    encode_image(name_path),
                    encode_image(context_path),
                ],
            }
        ],
    }

    request = urllib.request.Request(
        OLLAMA_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(
            request,
            timeout=max(5, timeout_seconds),
        ) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        error_body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Ollama HTTP {error.code}: {error_body}"
        ) from error

    content = body.get("message", {}).get("content", "").strip()

    if not content:
        raise RuntimeError("Qwen returned an empty response.")

    try:
        return parse_json_content(content)
    except json.JSONDecodeError:
        return {
            "parse_error": True,
            "raw_response": content,
        }


def normalize_name_extraction(item: dict) -> dict:
    medicine_raw = item.get("medicine_raw")

    if medicine_raw is not None:
        medicine_raw = (
            clean_medicine_name(str(medicine_raw))
            or None
        )

    non_medicine_type = (
        classify_non_medicine_name(medicine_raw)
        if medicine_raw
        else None
    )

    uncertain_fields = item.get("uncertain_fields") or []

    if not isinstance(uncertain_fields, list):
        uncertain_fields = []

    uncertain_fields = [
        str(field)
        for field in uncertain_fields
        if str(field).strip()
    ]

    is_medicine_row = item.get("is_medicine_row")
    row_type = str(item.get("row_type") or "").strip().lower()

    if non_medicine_type:
        is_medicine_row = False
        row_type = non_medicine_type
        medicine_raw = None
    elif medicine_raw and is_suspicious_medicine_name(medicine_raw):
        is_medicine_row = True
        row_type = "medicine"
        medicine_raw = None

        if "medicine_raw" not in uncertain_fields:
            uncertain_fields.append("medicine_raw")
    elif medicine_raw and not is_plausible_medicine_name(medicine_raw):
        is_medicine_row = None
        row_type = "other"
        medicine_raw = None
    elif medicine_raw and is_medicine_row is not False:
        is_medicine_row = True
        row_type = "medicine"

    if row_type not in {
        "medicine",
        "advice",
        "device",
        "exercise",
        "signature",
        "blank",
        "other",
    }:
        row_type = "medicine" if medicine_raw else "other"

    return {
        "is_medicine_row": is_medicine_row,
        "row_type": row_type,
        "line_number": None,
        "dosage_form": item.get("dosage_form"),
        "medicine_raw": medicine_raw,
        "formulation_suffix": None,
        "strength": item.get("strength"),
        "quantity": None,
        "schedule_raw": None,
        "morning": None,
        "afternoon": None,
        "evening": None,
        "exact_time": None,
        "food_timing": None,
        "uncertain_fields": uncertain_fields,
    }


def build_name_grid(
    rows: list[dict],
    grid_path: Path,
) -> list[int]:
    valid_rows: list[tuple[int, Path]] = []

    for row in rows:
        try:
            output_row = int(row["output_row"])
        except (KeyError, TypeError, ValueError):
            continue

        name_path = Path(str(row.get("name_file") or ""))

        if name_path.exists():
            valid_rows.append((output_row, name_path))

    if not valid_rows:
        return []

    cell_width = 520
    cell_height = 118
    grid = Image.new(
        "RGB",
        (cell_width, cell_height * len(valid_rows)),
        "white",
    )
    draw = ImageDraw.Draw(grid)

    for index, (output_row, path) in enumerate(valid_rows):
        top = index * cell_height

        with Image.open(path) as source:
            crop = source.convert("RGB")

        grayscale = ImageOps.grayscale(crop)
        content_box = ImageOps.invert(grayscale).getbbox()

        if content_box:
            crop = crop.crop(content_box)

        maximum_width = 440
        maximum_height = 88
        scale = min(
            maximum_width / max(1, crop.width),
            maximum_height / max(1, crop.height),
        )
        resized_width = max(1, int(crop.width * scale))
        resized_height = max(1, int(crop.height * scale))
        crop = crop.resize(
            (resized_width, resized_height),
            Image.Resampling.LANCZOS,
        )

        draw.rectangle(
            (0, top, cell_width - 1, top + cell_height - 1),
            outline="black",
            width=1,
        )
        draw.text((8, top + 8), f"R{output_row}", fill="black")

        grid.paste(
            crop,
            (
                62,
                top + (cell_height - resized_height) // 2,
            ),
        )

    grid.save(
        grid_path,
        format="JPEG",
        quality=92,
        optimize=True,
    )

    return [number for number, _ in valid_rows]


def call_qwen_name(
    model: str,
    name_path: Path,
    ocr_hint: str,
    timeout_seconds: int = 75,
    num_predict: int = 90,
) -> dict:
    prompt = f"""
Read this one handwritten prescription row crop.

OCR hint, if any: {ocr_hint}

Return JSON only:

{{
  "is_medicine_row": true,
  "row_type": "medicine",
  "dosage_form": null,
  "medicine_raw": "visible medicine name",
  "strength": null,
  "uncertain_fields": []
}}

Rules:
- Transcribe only the visible medicine name in this crop.
- Exclude Rx marks, serial numbers, dosage-form words, strength, quantity and schedule marks from medicine_raw.
- Example: "Tab. Diclofenac 50mg 2+0+2" should return medicine_raw "Diclofenac".
- Preserve the visible spelling; do not autocorrect with medical knowledge.
- Use null for unreadable or absent values.
- Set row_type to advice, device, exercise, signature, blank, or other when no medicine name is visible.
- Knee cap, brace, physiotherapy and exercise instructions are not medicines.
- CBC, LFT, lab reports, echo, BP charts, oxygen concentrators, masks, precautions, pregnancy warnings and avoid-instructions are not medicines.
- Prescriber names, M.D./doctor/office/license text, and Sig./Signa/local application instruction rows are not medicines.
- If any part of the name is unclear, include "medicine_raw" in uncertain_fields.
""".strip()

    payload = {
        "model": model,
        "stream": False,
        "format": "json",
        "keep_alive": "30m",
        "options": {
            "temperature": 0,
            "num_predict": num_predict,
            "num_ctx": 1024,
        },
        "messages": [
            {
                "role": "user",
                "content": prompt,
                "images": [
                    encode_image(name_path),
                ],
            }
        ],
    }

    request = urllib.request.Request(
        OLLAMA_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(
            request,
            timeout=max(10, timeout_seconds),
        ) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        error_body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Ollama HTTP {error.code}: {error_body}"
        ) from error

    content = body.get("message", {}).get("content", "").strip()

    if not content:
        raise RuntimeError("Qwen returned an empty name response.")

    try:
        parsed = parse_json_content(content)
    except json.JSONDecodeError:
        return {
            "parse_error": True,
            "raw_response": content,
            "is_medicine_row": None,
            "row_type": "other",
            "medicine_raw": None,
            "uncertain_fields": ["medicine_raw"],
        }

    if not isinstance(parsed, dict):
        return {
            "parse_error": True,
            "raw_response": content,
            "is_medicine_row": None,
            "row_type": "other",
            "medicine_raw": None,
            "uncertain_fields": ["medicine_raw"],
        }

    return normalize_name_extraction(parsed)


def call_qwen_name_batch(
    model: str,
    rows: list[dict],
    output_dir: Path,
    batch_index: int,
    timeout_seconds: int = 75,
    num_predict: int = 160,
) -> list[dict]:
    grid_path = output_dir / f"qwen-name-batch-{batch_index:02d}.jpg"
    row_numbers = build_name_grid(rows, grid_path)

    if not row_numbers:
        return []

    prompt = f"""
Read these handwritten prescription row crops.

Labels: {row_numbers}

Return compact JSON only:

{{"rows":[{{"r":1,"t":"medicine","n":"visible medicine name","u":false}}]}}

Rules:
- r is the visible R-number.
- t must be one of medicine, advice, device, exercise, blank, other.
- n is only the medicine name. Exclude Rx marks, serial numbers, dosage form words, strength, quantity and schedule marks.
- Example: "Tab. Diclofenac 50mg 2+0+2" should return n "Diclofenac".
- Knee cap, brace, physiotherapy and exercise instructions are not medicines.
- Prescriber names, M.D./doctor/office/license text, and Sig./Signa/local application instruction rows are not medicines.
- CBC, LFT, lab reports, echo, BP charts, oxygen concentrators, masks, precautions, pregnancy warnings and avoid-instructions are not medicines.
- Preserve visible medicine spelling. Do not autocorrect using medical knowledge.
- Use null for n when t is not medicine or the name is unreadable.
- Use t "signature" and n null for prescriber names, M.D./doctor/office/license text, and Sig./Signa/local application instruction rows.
- u is true when any part of the medicine name is unclear.
""".strip()

    payload = {
        "model": model,
        "stream": False,
        "format": "json",
        "keep_alive": "30m",
        "options": {
            "temperature": 0,
            "num_predict": num_predict,
            "num_ctx": 1024,
        },
        "messages": [
            {
                "role": "user",
                "content": prompt,
                "images": [
                    encode_image(grid_path),
                ],
            }
        ],
    }

    request = urllib.request.Request(
        OLLAMA_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(
            request,
            timeout=max(10, timeout_seconds),
        ) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        error_body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Ollama HTTP {error.code}: {error_body}"
        ) from error

    content = body.get("message", {}).get("content", "").strip()

    if not content:
        raise RuntimeError("Qwen returned an empty batch response.")

    try:
        parsed = parse_json_content(content)
    except json.JSONDecodeError as error:
        raise RuntimeError(
            "Qwen returned malformed batch JSON."
        ) from error

    items = (
        parsed
        if isinstance(parsed, list)
        else parsed.get("rows")
        if isinstance(parsed, dict)
        else None
    )

    if not isinstance(items, list):
        raise RuntimeError(
            "Qwen batch response did not contain rows."
        )

    allowed_rows = set(row_numbers)
    normalized: list[dict] = []

    for item in items:
        if not isinstance(item, dict):
            continue

        raw_row = item.get("r", item.get("output_row"))

        try:
            output_row = int(raw_row)
        except (TypeError, ValueError):
            continue

        if output_row not in allowed_rows:
            continue

        row_type = str(item.get("t") or item.get("row_type") or "").strip().lower()
        medicine_name = item.get("n", item.get("medicine_raw"))
        uncertain = item.get("u") is True
        uncertain_fields = ["medicine_raw"] if uncertain else []

        if row_type and row_type != "medicine":
            medicine_name = None

        extraction = normalize_name_extraction(
            {
                "is_medicine_row": row_type in ("", "medicine"),
                "row_type": row_type or "medicine",
                "medicine_raw": medicine_name,
                "strength": item.get("strength"),
                "uncertain_fields": uncertain_fields,
            }
        )
        extraction["line_number"] = output_row

        normalized.append(
            {
                "output_row": output_row,
                "extracted": extraction,
            }
        )

    return normalized


def build_sparse_body_grid(
    rows: list[dict],
    grid_path: Path,
) -> list[int]:
    valid_rows: list[tuple[int, Path]] = []

    for row in rows:
        try:
            output_row = int(row["output_row"])
        except (KeyError, TypeError, ValueError):
            continue

        name_path = Path(str(row.get("name_file") or ""))

        if name_path.exists():
            valid_rows.append((output_row, name_path))

    if not valid_rows:
        return []

    cell_width = 820
    cell_height = 280
    grid = Image.new(
        "RGB",
        (cell_width, cell_height * len(valid_rows)),
        "white",
    )
    draw = ImageDraw.Draw(grid)

    for index, (output_row, path) in enumerate(valid_rows):
        top = index * cell_height

        with Image.open(path) as source:
            crop = ImageOps.exif_transpose(source.convert("RGB"))

        max_width = cell_width - 78
        max_height = cell_height - 34
        scale = min(
            max_width / max(1, crop.width),
            max_height / max(1, crop.height),
        )
        resized_width = max(1, int(crop.width * scale))
        resized_height = max(1, int(crop.height * scale))
        crop = crop.resize(
            (resized_width, resized_height),
            Image.Resampling.LANCZOS,
        )

        draw.rectangle(
            (0, top, cell_width - 1, top + cell_height - 1),
            outline="black",
            width=1,
        )
        draw.text((8, top + 8), f"R{output_row}", fill="black")

        grid.paste(
            crop,
            (
                60,
                top + (cell_height - resized_height) // 2,
            ),
        )

    grid.save(
        grid_path,
        format="JPEG",
        quality=94,
        optimize=True,
    )

    return [number for number, _ in valid_rows]


def call_qwen_sparse_body_batch(
    model: str,
    rows: list[dict],
    output_dir: Path,
    timeout_seconds: int = 90,
    num_predict: int = 180,
) -> list[dict]:
    grid_path = output_dir / "qwen-sparse-body-grid.jpg"
    row_numbers = build_sparse_body_grid(rows, grid_path)

    if not row_numbers:
        return []

    prompt = f"""
Read these broad crops from a sparse handwritten prescription.

Labels: {row_numbers}

Each labeled crop may contain one prescribed medicine line plus nearby
dosage/instruction text. The crop may also be blank, a signature, doctor
details, patient details, or an instruction-only line.

Return compact JSON only:

{{"rows":[{{"r":1,"t":"medicine","n":"visible medicine name","u":false}}]}}

Rules:
- r is the visible R-number.
- t must be one of medicine, advice, device, exercise, signature, blank, other.
- n is only the medicine/drug name. Exclude dosage form, strength, route, schedule, duration and instructions.
- If the visible line says something like "Remdesivir 200mg IV stat", return n "Remdesivir".
- Preserve visible medicine spelling. Do not autocorrect using medical knowledge.
- Do not guess from diagnosis, hospital name, doctor name, or nearby text.
- Use null for n when the medicine name is unreadable or absent.
- Set u true if any part of the medicine name is unclear.
- Prescriber names, M.D./doctor/office/license text, signatures, Sig./Signa/local application instruction rows are not medicines.
- Patient details, dates, IDs, stamps, logos and hospital headers are not medicines.
""".strip()

    payload = {
        "model": model,
        "stream": False,
        "format": "json",
        "keep_alive": "30m",
        "options": {
            "temperature": 0,
            "num_predict": num_predict,
            "num_ctx": 1536,
        },
        "messages": [
            {
                "role": "user",
                "content": prompt,
                "images": [
                    encode_image(grid_path),
                ],
            }
        ],
    }

    request = urllib.request.Request(
        OLLAMA_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(
            request,
            timeout=max(10, timeout_seconds),
        ) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        error_body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Ollama HTTP {error.code}: {error_body}"
        ) from error

    content = body.get("message", {}).get("content", "").strip()

    if not content:
        raise RuntimeError("Qwen returned an empty sparse response.")

    try:
        parsed = parse_json_content(content)
    except json.JSONDecodeError as error:
        raise RuntimeError(
            "Qwen returned malformed sparse JSON."
        ) from error

    items = (
        parsed
        if isinstance(parsed, list)
        else parsed.get("rows")
        if isinstance(parsed, dict)
        else None
    )

    if not isinstance(items, list):
        raise RuntimeError(
            "Qwen sparse response did not contain rows."
        )

    allowed_rows = set(row_numbers)
    normalized: list[dict] = []

    for item in items:
        if not isinstance(item, dict):
            continue

        try:
            output_row = int(item.get("r", item.get("output_row")))
        except (TypeError, ValueError):
            continue

        if output_row not in allowed_rows:
            continue

        row_type = str(item.get("t") or item.get("row_type") or "").strip().lower()
        medicine_name = item.get("n", item.get("medicine_raw"))
        uncertain = item.get("u") is True
        uncertain_fields = ["medicine_raw"] if uncertain else []

        if row_type and row_type != "medicine":
            medicine_name = None

        extraction = normalize_name_extraction(
            {
                "is_medicine_row": row_type in ("", "medicine"),
                "row_type": row_type or "medicine",
                "medicine_raw": medicine_name,
                "uncertain_fields": uncertain_fields,
            }
        )
        extraction["line_number"] = output_row

        normalized.append(
            {
                "output_row": output_row,
                "extracted": extraction,
            }
        )

    return normalized



def call_qwen_document(
    model: str,
    image_path: Path,
    contact_sheet_path: Path,
    rows: list[dict],
    timeout_seconds: int = 90,
) -> list[dict]:
    # Paddle has already detected and cropped probable medicine rows.
    # Qwen receives only those tight name crops.
    del image_path
    del contact_sheet_path

    valid_rows: list[tuple[int, Path]] = []

    for row in rows:
        try:
            output_row = int(row["output_row"])
        except (KeyError, TypeError, ValueError):
            continue

        name_path = Path(
            str(row.get("name_file") or "")
        )

        if name_path.exists():
            valid_rows.append(
                (output_row, name_path)
            )

    if not valid_rows:
        return []

    cell_width = 480
    cell_height = 112
    column_count = 2

    grid_row_count = (
        len(valid_rows) + column_count - 1
    ) // column_count

    grid = Image.new(
        "RGB",
        (
            cell_width * column_count,
            cell_height * grid_row_count,
        ),
        "white",
    )

    draw = ImageDraw.Draw(grid)

    for index, (output_row, path) in enumerate(valid_rows):
        column = index % column_count
        grid_row = index // column_count

        left = column * cell_width
        top = grid_row * cell_height

        with Image.open(path) as source:
            crop = source.convert("RGB")

        # Remove large empty margins around handwriting.
        grayscale = ImageOps.grayscale(crop)
        content_box = ImageOps.invert(
            grayscale
        ).getbbox()

        if content_box:
            crop = crop.crop(content_box)

        maximum_width = 405
        maximum_height = 84

        scale = min(
            maximum_width / max(1, crop.width),
            maximum_height / max(1, crop.height),
        )

        resized_width = max(
            1,
            int(crop.width * scale),
        )
        resized_height = max(
            1,
            int(crop.height * scale),
        )

        crop = crop.resize(
            (resized_width, resized_height),
            Image.Resampling.LANCZOS,
        )

        draw.rectangle(
            (
                left,
                top,
                left + cell_width - 1,
                top + cell_height - 1,
            ),
            outline="black",
            width=1,
        )

        draw.text(
            (left + 8, top + 8),
            f"R{output_row}",
            fill="black",
        )

        paste_x = left + 60
        paste_y = top + (
            cell_height - resized_height
        ) // 2

        grid.paste(
            crop,
            (paste_x, paste_y),
        )

    grid_path = (
        Path(valid_rows[0][1]).parents[1]
        / "qwen-medicine-name-grid.jpg"
    )

    grid.save(
        grid_path,
        format="JPEG",
        quality=92,
        optimize=True,
    )

    row_numbers = [
        number
        for number, _ in valid_rows
    ]

    prompt = f"""
PaddleOCR has already detected the probable medicine rows.

Each box in this image is one tight medicine-name crop.
The labels are: {row_numbers}

Your only task is to transcribe the visible medicine name.

Do not:
- detect rows
- analyze page layout
- extract schedules
- extract quantity
- extract strength
- give medical advice
- correct names using medical knowledge

Return compact JSON only:

{{"rows":[{{"r":1,"n":"visible name","u":false}}]}}

Rules:
- r is the visible R-number.
- n preserves the visible spelling.
- u is true when any part of the name is unclear.
- Omit a box only when no medicine name is visible.
- Omit signatures, prescriber names, M.D./doctor/office/license text, and Sig./Signa/local application instruction rows.
- Never invent a medicine name.
""".strip()

    payload = {
        "model": model,
        "stream": False,
        "format": "json",
        "keep_alive": "30m",
        "options": {
            "temperature": 0,
            "num_predict": 160,
            "num_ctx": 1024,
        },
        "messages": [
            {
                "role": "user",
                "content": prompt,
                "images": [
                    encode_image(grid_path),
                ],
            }
        ],
    }

    request = urllib.request.Request(
        OLLAMA_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json"
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(
            request,
            timeout=max(10, timeout_seconds),
        ) as response:
            body = json.loads(
                response.read().decode("utf-8")
            )
    except Exception as error:
        raise RuntimeError(
            "Qwen medicine-name transcription failed: "
            f"{error}"
        ) from error

    content = (
        body.get("message", {})
        .get("content", "")
        .strip()
    )

    if not content:
        raise RuntimeError(
            "Qwen returned an empty name response."
        )

    try:
        parsed = parse_json_content(content)
    except json.JSONDecodeError as error:
        raise RuntimeError(
            "Qwen returned malformed name JSON."
        ) from error

    items = (
        parsed
        if isinstance(parsed, list)
        else parsed.get("rows")
        if isinstance(parsed, dict)
        else None
    )

    if not isinstance(items, list):
        raise RuntimeError(
            "Qwen response did not contain rows."
        )

    allowed_rows = set(row_numbers)
    normalized: list[dict] = []

    for item in items:
        if not isinstance(item, dict):
            continue

        raw_row = item.get(
            "r",
            item.get("output_row"),
        )

        try:
            output_row = int(raw_row)
        except (TypeError, ValueError):
            continue

        if output_row not in allowed_rows:
            continue

        medicine_name = str(
            item.get(
                "n",
                item.get("medicine_raw") or "",
            )
        ).strip()

        if not medicine_name:
            continue

        uncertain = item.get("u") is True

        normalized.append(
            {
                "output_row": output_row,
                "is_medicine_row": True,
                "row_type": "medicine",
                "line_number": output_row,
                "dosage_form": None,
                "medicine_raw": medicine_name,
                "formulation_suffix": None,
                "strength": None,
                "quantity": None,
                "schedule_raw": None,
                "morning": None,
                "afternoon": None,
                "evening": None,
                "exact_time": None,
                "food_timing": None,
                "uncertain_fields": (
                    ["medicine_raw"]
                    if uncertain
                    else []
                ),
            }
        )

    return normalized


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Read medicine names, quantities and instructions with Qwen3-VL."
    )
    parser.add_argument(
        "--image",
        type=Path,
        default=DEFAULT_IMAGE,
    )
    parser.add_argument(
        "--metadata",
        type=Path,
        default=DEFAULT_METADATA,
    )
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
    )
    args = parser.parse_args()

    if not args.image.exists():
        raise FileNotFoundError(f"Prescription not found: {args.image}")

    if not args.metadata.exists():
        raise FileNotFoundError(f"Metadata not found: {args.metadata}")

    rows = create_context_crops(
        image_path=args.image,
        metadata_path=args.metadata,
    )

    results: list[dict] = []

    print("Reading medicine rows with Qwen3-VL...")
    print()

    for row in rows:
        output_row = int(row["output_row"])
        name_path = Path(row["name_file"])
        context_path = Path(row["context_file"])

        if not name_path.exists():
            raise FileNotFoundError(f"Name crop missing: {name_path}")

        extracted = call_qwen(
            model=args.model,
            name_path=name_path,
            context_path=context_path,
            ocr_hint=str(row.get("ocr_anchor_text", "")),
        )

        record = {
            "output_row": output_row,
            "column": row["column"],
            "ocr_anchor_text": row.get("ocr_anchor_text"),
            "ocr_confidence": row.get("ocr_confidence"),
            "extracted": extracted,
            "name_file": str(name_path),
            "context_file": str(context_path),
        }
        results.append(record)

        print(f"===== ROW {output_row} =====")
        print(json.dumps(extracted, indent=2, ensure_ascii=False))
        print()

    output_path = args.metadata.parent / "qwen-row-results.json"
    output_path.write_text(
        json.dumps(results, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    print(f"Saved results: {output_path}")


if __name__ == "__main__":
    main()
