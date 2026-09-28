from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path
from types import ModuleType


ROW_READER_MODES = {
    "row",
    "rows",
    "per-row",
    "row-by-row",
}

BATCH_READER_MODES = {
    "batch",
    "document",
    "grid",
}


def load_module(name: str, path: Path) -> ModuleType:
    if not path.exists():
        raise FileNotFoundError(f"Required pipeline file not found: {path}")

    spec = importlib.util.spec_from_file_location(name, path)

    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load module: {path}")

    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def should_prefer_row_reader(model: str) -> bool:
    requested_mode = os.environ.get(
        "MEDITRACK_QWEN_EXTRACTION_MODE",
        "",
    ).strip().lower()

    if requested_mode in ROW_READER_MODES:
        return True

    if requested_mode in BATCH_READER_MODES:
        return False

    normalized_model = model.strip().lower()

    return (
        ":2b" in normalized_model
        or "-2b" in normalized_model
        or "2b-" in normalized_model
    )


def write_qwen_cache(
    qwen_results_path: Path,
    qwen_cache_meta_path: Path,
    qwen_results: list[dict],
    cache_identity: dict,
) -> None:
    qwen_results.sort(
        key=lambda item: int(item["output_row"])
    )

    qwen_results_path.write_text(
        json.dumps(
            qwen_results,
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    qwen_cache_meta_path.write_text(
        json.dumps(
            cache_identity,
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def build_qwen_result(
    output_row: int,
    source_row: dict,
    extracted: dict,
    image_path: Path,
) -> dict:
    return {
        "output_row": output_row,
        "column": source_row.get("column"),
        "ocr_anchor_text": source_row.get(
            "ocr_anchor_text"
        ),
        "ocr_confidence": source_row.get(
            "ocr_confidence"
        ),
        "extracted": extracted,
        "name_file": str(
            source_row.get("name_file")
            or image_path
        ),
        "context_file": str(
            source_row.get("context_file")
            or image_path
        ),
    }


def upsert_qwen_result(
    qwen_results: list[dict],
    record: dict,
) -> None:
    output_row = int(record["output_row"])

    for index, existing in enumerate(qwen_results):
        try:
            existing_row = int(existing["output_row"])
        except (KeyError, TypeError, ValueError):
            continue

        if existing_row == output_row:
            qwen_results[index] = record
            return

    qwen_results.append(record)


def needs_row_retry(extracted: dict) -> bool:
    if not isinstance(extracted, dict):
        return True

    if extracted.get("parse_error") is True:
        return True

    uncertain_fields = list(
        extracted.get("uncertain_fields") or []
    )

    return (
        extracted.get("is_medicine_row") is not False
        and (
            not extracted.get("medicine_raw")
            or "medicine_raw" in uncertain_fields
        )
    )


def parse_positive_int(
    name: str,
    default: int,
) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except ValueError:
        return default

    return max(1, value)


def resolve_reader_image_path(
    metadata_path: Path,
    fallback_path: Path,
) -> Path:
    try:
        metadata = json.loads(
            metadata_path.read_text(encoding="utf-8")
        )
    except (OSError, json.JSONDecodeError):
        return fallback_path

    if not isinstance(metadata, list):
        return fallback_path

    for row in metadata:
        if not isinstance(row, dict):
            continue

        page_file = row.get("page_image_file")

        if not page_file:
            continue

        candidate = Path(str(page_file))

        if candidate.exists():
            return candidate.resolve()

    return fallback_path


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Run the complete local prescription vision pipeline: "
            "row detection, Qwen3-VL extraction, and safe review payload."
        )
    )
    parser.add_argument(
        "--image",
        required=True,
        type=Path,
        help="Absolute path to a prescription JPG or PNG.",
    )
    parser.add_argument(
        "--output",
        required=True,
        type=Path,
        help="Directory in which pipeline evidence and JSON will be stored.",
    )
    parser.add_argument(
        "--model",
        default="qwen3-vl:2b-instruct",
        help="Ollama vision model name.",
    )
    args = parser.parse_args()

    image_path = args.image.resolve()
    output_dir = args.output.resolve()
    service_dir = Path(__file__).resolve().parent

    if not image_path.exists():
        raise FileNotFoundError(f"Prescription image not found: {image_path}")

    detector_path = service_dir / "medicine_row_detector_final.py"
    reader_path = service_dir / "qwen_row_reader.py"

    print("STEP 1/3: Detecting medicine rows...")

    detector_environment = os.environ.copy()

    detector_environment[
        "MEDITRACK_IMAGE_PATH"
    ] = str(image_path)

    detector_environment[
        "MEDITRACK_OUTPUT_DIR"
    ] = str(output_dir)

    detector_result = subprocess.run(
        [
            sys.executable,
            str(detector_path),
        ],
        cwd=str(service_dir),
        env=detector_environment,
        text=True,
        capture_output=True,
        check=False,
    )

    if detector_result.stdout:
        print(detector_result.stdout)

    if detector_result.returncode != 0:
        raise RuntimeError(
            "Paddle medicine-row detection failed. "
            + detector_result.stderr[-4000:]
        )

    # The Paddle child process has exited here, releasing its GPU
    # allocation before Qwen is called.

    metadata_path = output_dir / "metadata.json"

    if not metadata_path.exists():
        raise RuntimeError(
            f"Detector did not create metadata: {metadata_path}"
        )

    reader_image_path = resolve_reader_image_path(
        metadata_path,
        image_path,
    )

    print()
    print("STEP 2/3: Reading rows with Qwen3-VL...")

    reader = load_module(
        "meditrack_qwen_row_reader",
        reader_path,
    )

    rows = reader.create_context_crops(
        image_path=reader_image_path,
        metadata_path=metadata_path,
    )
    sparse_mode = bool(rows) and all(
        str(row.get("crop_mode") or "") == "sparse_body"
        for row in rows
    )

    qwen_results_path = output_dir / "qwen-row-results.json"
    qwen_cache_meta_path = output_dir / "qwen-cache-meta.json"

    cache_identity = {
        "image_sha256": hashlib.sha256(
            image_path.read_bytes()
        ).hexdigest(),
        "metadata_sha256": hashlib.sha256(
            metadata_path.read_bytes()
        ).hexdigest(),
        "detector_sha256": hashlib.sha256(
            detector_path.read_bytes()
        ).hexdigest(),
        "reader_sha256": hashlib.sha256(
            reader_path.read_bytes()
        ).hexdigest(),
        "reader_image_sha256": hashlib.sha256(
            reader_image_path.read_bytes()
        ).hexdigest(),
        "model": args.model,
        "mode": "paddle_rows_qwen_hybrid_v7",
    }

    qwen_results: list[dict] = []

    if (
        qwen_results_path.exists()
        and qwen_cache_meta_path.exists()
    ):
        try:
            stored_identity = json.loads(
                qwen_cache_meta_path.read_text(
                    encoding="utf-8"
                )
            )

            if stored_identity == cache_identity:
                cached_value = json.loads(
                    qwen_results_path.read_text(
                        encoding="utf-8"
                    )
                )

                if isinstance(cached_value, list):
                    qwen_results = cached_value
        except (OSError, json.JSONDecodeError):
            qwen_results = []

    if qwen_results:
        print(
            "Using cached Qwen extraction "
            f"with {len(qwen_results)} row(s)."
        )
    else:
        contact_sheet_path = output_dir / "contact-sheet.jpg"

        if not contact_sheet_path.exists():
            raise RuntimeError(
                "Detector did not create contact-sheet.jpg."
            )

        detected_by_number = {
            int(row["output_row"]): row
            for row in rows
        }

        prefer_row_reader = should_prefer_row_reader(
            args.model
        )

        if prefer_row_reader:
            print(
                "Using row-by-row Qwen extraction for this "
                "small vision model."
            )
            document_rows = []
        else:
            try:
                document_rows = reader.call_qwen_document(
                    model=args.model,
                    image_path=reader_image_path,
                    contact_sheet_path=contact_sheet_path,
                    rows=rows,
                    timeout_seconds=90,
                )
            except Exception as error:
                # Do not convert infrastructure/model failure into a
                # successful zero-medicine result or cache it.
                raise RuntimeError(
                    "Document-level Qwen extraction failed: "
                    f"{error}"
                ) from error

        used_numbers: set[int] = set()

        for index, item in enumerate(document_rows, start=1):
            raw_number = item.get("output_row")

            try:
                output_row = int(raw_number)
            except (TypeError, ValueError):
                output_row = 0

            source_row = detected_by_number.get(output_row)

            if source_row is None:
                continue

            used_numbers.add(output_row)

            extracted = item.get("extracted")

            if not isinstance(extracted, dict):
                extracted = {
                    key: value
                    for key, value in item.items()
                    if key != "output_row"
                }

            upsert_qwen_result(
                qwen_results,
                build_qwen_result(
                    output_row=output_row,
                    source_row=source_row,
                    extracted=extracted,
                    image_path=reader_image_path,
                ),
            )

        row_fallback_numbers: list[int] = []

        if prefer_row_reader or not qwen_results:
            row_fallback_numbers = sorted(
                detected_by_number
            )
        else:
            completed_numbers = {
                int(record["output_row"])
                for record in qwen_results
                if record.get("output_row") is not None
            }

            for output_row in sorted(detected_by_number):
                if output_row not in completed_numbers:
                    row_fallback_numbers.append(output_row)

            for record in qwen_results:
                try:
                    output_row = int(record["output_row"])
                except (KeyError, TypeError, ValueError):
                    continue

                if needs_row_retry(
                    record.get("extracted") or {}
                ):
                    row_fallback_numbers.append(output_row)

        row_fallback_numbers = sorted(
            set(row_fallback_numbers)
        )
        context_fallback_numbers: set[int] = set()

        sparse_batch_available = (
            prefer_row_reader
            and sparse_mode
            and row_fallback_numbers
            and hasattr(reader, "call_qwen_sparse_body_batch")
        )

        if row_fallback_numbers and sparse_batch_available:
            print(
                "Running sparse body Qwen extraction for "
                f"{len(row_fallback_numbers)} crop(s)."
            )
        elif row_fallback_numbers:
            print(
                "Running row-level Qwen extraction for "
                f"{len(row_fallback_numbers)} row(s)."
            )

        if sparse_batch_available:
            sparse_numbers = list(row_fallback_numbers)
            sparse_rows = [
                detected_by_number[number]
                for number in sparse_numbers
                if number in detected_by_number
            ]

            try:
                sparse_items = reader.call_qwen_sparse_body_batch(
                    model=args.model,
                    rows=sparse_rows,
                    output_dir=output_dir,
                    timeout_seconds=parse_positive_int(
                        "MEDITRACK_QWEN_SPARSE_TIMEOUT_SECONDS",
                        90,
                    ),
                )
            except Exception as error:
                print(
                    "Sparse Qwen extraction failed: "
                    f"{error}"
                )
                sparse_items = []

            completed_sparse_numbers: set[int] = set()

            for item in sparse_items:
                try:
                    output_row = int(item["output_row"])
                except (KeyError, TypeError, ValueError):
                    continue

                source_row = detected_by_number.get(output_row)

                if source_row is None:
                    continue

                extracted = item.get("extracted")

                if not isinstance(extracted, dict):
                    continue

                completed_sparse_numbers.add(output_row)

                upsert_qwen_result(
                    qwen_results,
                    build_qwen_result(
                        output_row=output_row,
                        source_row=source_row,
                        extracted=extracted,
                        image_path=reader_image_path,
                    ),
                )

            for output_row in sparse_numbers:
                if output_row in completed_sparse_numbers:
                    continue

                source_row = detected_by_number.get(output_row)

                if source_row is None:
                    continue

                upsert_qwen_result(
                    qwen_results,
                    build_qwen_result(
                        output_row=output_row,
                        source_row=source_row,
                        extracted={
                            "is_medicine_row": True,
                            "row_type": "medicine",
                            "line_number": output_row,
                            "dosage_form": None,
                            "medicine_raw": None,
                            "formulation_suffix": None,
                            "strength": None,
                            "quantity": None,
                            "schedule_raw": None,
                            "morning": None,
                            "afternoon": None,
                            "evening": None,
                            "exact_time": None,
                            "food_timing": None,
                            "uncertain_fields": ["medicine_raw"],
                        },
                        image_path=reader_image_path,
                    ),
                )

            write_qwen_cache(
                qwen_results_path=qwen_results_path,
                qwen_cache_meta_path=qwen_cache_meta_path,
                qwen_results=qwen_results,
                cache_identity=cache_identity,
            )

            print(
                "Processed sparse prescription crop batch "
                f"with {len(sparse_rows)} crop(s)"
            )

            row_fallback_numbers = []

        if (
            prefer_row_reader
            and row_fallback_numbers
            and hasattr(reader, "call_qwen_name_batch")
        ):
            batch_size = parse_positive_int(
                "MEDITRACK_QWEN_NAME_BATCH_SIZE",
                3,
            )
            batch_timeout = parse_positive_int(
                "MEDITRACK_QWEN_BATCH_TIMEOUT_SECONDS",
                75,
            )

            for batch_index, start in enumerate(
                range(0, len(row_fallback_numbers), batch_size),
                start=1,
            ):
                chunk_numbers = row_fallback_numbers[
                    start : start + batch_size
                ]
                chunk_rows = [
                    detected_by_number[number]
                    for number in chunk_numbers
                    if number in detected_by_number
                ]

                try:
                    batch_items = reader.call_qwen_name_batch(
                        model=args.model,
                        rows=chunk_rows,
                        output_dir=output_dir,
                        batch_index=batch_index,
                        timeout_seconds=batch_timeout,
                    )
                except Exception as error:
                    print(
                        "Batch Qwen extraction failed for "
                        f"rows {chunk_numbers}: {error}"
                    )
                    continue

                for item in batch_items:
                    try:
                        output_row = int(item["output_row"])
                    except (KeyError, TypeError, ValueError):
                        continue

                    source_row = detected_by_number.get(output_row)

                    if source_row is None:
                        continue

                    extracted = item.get("extracted")

                    if not isinstance(extracted, dict):
                        continue

                    upsert_qwen_result(
                        qwen_results,
                        build_qwen_result(
                            output_row=output_row,
                            source_row=source_row,
                            extracted=extracted,
                            image_path=reader_image_path,
                        ),
                    )

                if batch_items:
                    write_qwen_cache(
                        qwen_results_path=qwen_results_path,
                        qwen_cache_meta_path=qwen_cache_meta_path,
                        qwen_results=qwen_results,
                        cache_identity=cache_identity,
                    )

                    print(
                        "Processed and cached batch "
                        f"{batch_index} with {len(batch_items)} row(s)"
                    )

            completed_numbers = {
                int(record["output_row"])
                for record in qwen_results
                if record.get("output_row") is not None
            }

            if hasattr(reader, "canonical_medicine_key"):
                seen_keys: set[str] = set()

                for record in sorted(
                    qwen_results,
                    key=lambda item: int(item.get("output_row") or 0),
                ):
                    extracted = record.get("extracted") or {}
                    raw_name = extracted.get("medicine_raw")

                    if not raw_name:
                        continue

                    key = reader.canonical_medicine_key(str(raw_name))

                    if not key:
                        continue

                    if key in seen_keys:
                        try:
                            context_fallback_numbers.add(
                                int(record["output_row"])
                            )
                        except (KeyError, TypeError, ValueError):
                            continue
                    else:
                        seen_keys.add(key)

            row_fallback_numbers = [
                number
                for number in row_fallback_numbers
                if number not in completed_numbers
            ]
            row_fallback_numbers = sorted(
                set(row_fallback_numbers)
                | context_fallback_numbers
            )

            single_fallback_limit = parse_positive_int(
                "MEDITRACK_QWEN_SINGLE_FALLBACK_LIMIT",
                2,
            )
            row_fallback_numbers = row_fallback_numbers[
                :single_fallback_limit
            ]

            if row_fallback_numbers:
                print(
                    "Running single-row fallback for "
                    f"{len(row_fallback_numbers)} row(s)."
                )

        row_timeout = parse_positive_int(
            "MEDITRACK_QWEN_ROW_TIMEOUT_SECONDS",
            45,
        )
        context_retry_timeout = parse_positive_int(
            "MEDITRACK_QWEN_CONTEXT_RETRY_TIMEOUT_SECONDS",
            120,
        )

        for output_row in row_fallback_numbers:
            source_row = detected_by_number.get(output_row)

            if source_row is None:
                continue

            name_path = Path(
                str(source_row.get("name_file") or "")
            )
            context_path = Path(
                str(source_row.get("context_file") or "")
            )

            if not name_path.exists():
                print(
                    "Skipping row-level Qwen extraction for "
                    f"row {output_row}: name crop missing."
                )
                continue

            if not context_path.exists():
                print(
                    "Skipping row-level Qwen extraction for "
                    f"row {output_row}: context crop missing."
                )
                continue

            try:
                if prefer_row_reader and hasattr(
                    reader,
                    "call_qwen_name",
                ) and output_row not in context_fallback_numbers:
                    extracted = reader.call_qwen_name(
                        model=args.model,
                        name_path=name_path,
                        ocr_hint=str(
                            source_row.get("ocr_anchor_text") or ""
                        ),
                        timeout_seconds=row_timeout,
                        num_predict=70,
                    )
                else:
                    extracted = reader.call_qwen(
                        model=args.model,
                        name_path=name_path,
                        context_path=context_path,
                        ocr_hint=str(
                            source_row.get("ocr_anchor_text") or ""
                        ),
                        timeout_seconds=max(
                            row_timeout,
                            context_retry_timeout,
                        ),
                        num_predict=260,
                    )

            except Exception as error:
                print(
                    "Row-level Qwen extraction failed for "
                    f"row {output_row}: {error}"
                )
                continue

            upsert_qwen_result(
                qwen_results,
                build_qwen_result(
                    output_row=output_row,
                    source_row=source_row,
                    extracted=extracted,
                    image_path=reader_image_path,
                ),
            )

            write_qwen_cache(
                qwen_results_path=qwen_results_path,
                qwen_cache_meta_path=qwen_cache_meta_path,
                qwen_results=qwen_results,
                cache_identity=cache_identity,
            )

            print(
                f"Processed and cached row {output_row}"
            )

        if not qwen_results:
            raise RuntimeError(
                "Qwen extraction produced no row results "
                f"for {len(rows)} detected row(s)."
            )

        write_qwen_cache(
            qwen_results_path=qwen_results_path,
            qwen_cache_meta_path=qwen_cache_meta_path,
            qwen_results=qwen_results,
            cache_identity=cache_identity,
        )

        print(
            "Qwen extraction produced "
            f"{len(qwen_results)} candidate row(s)."
        )

    print()
    print("STEP 3/3: Building safe human-review payload...")

    safe_rows: list[dict] = []
    seen_medicine_keys: set[str] = set()
    standalone_medicine_keys: set[str] = set()

    if hasattr(reader, "split_medicine_name_candidates") and hasattr(
        reader,
        "canonical_medicine_key",
    ):
        for source in qwen_results:
            extracted = source.get("extracted") or {}
            raw_name = extracted.get("medicine_raw")

            if not raw_name:
                continue

            candidates = reader.split_medicine_name_candidates(
                str(raw_name)
            )

            if len(candidates) == 1:
                key = reader.canonical_medicine_key(candidates[0])

                if key:
                    standalone_medicine_keys.add(key)

    for source in qwen_results:
        extracted = source.get("extracted") or {}

        is_medicine_row = extracted.get("is_medicine_row")
        row_type = str(
            extracted.get("row_type") or ""
        ).strip().lower()

        definite_non_medicine_types = {
            "advice",
            "device",
            "exercise",
            "signature",
            "blank",
        }

        if (
            is_medicine_row is False
            and row_type in definite_non_medicine_types
        ):
            continue

        uncertain_fields = list(
            extracted.get("uncertain_fields") or []
        )

        def nullable(value):
            if value in ("", [], {}):
                return None

            if isinstance(value, str):
                clean_value = value.strip()

                if clean_value.lower() in {
                    "null",
                    "none",
                    "unknown",
                    "unreadable",
                    "not visible",
                    "not readable",
                    "n/a",
                    "na",
                    "nil",
                    "no medicine",
                }:
                    return None

            return value

        medicine_raw = nullable(extracted.get("medicine_raw"))

        if medicine_raw and hasattr(reader, "clean_medicine_name"):
            medicine_raw = nullable(
                reader.clean_medicine_name(str(medicine_raw))
            )

        if (
            medicine_raw
            and hasattr(reader, "classify_non_medicine_name")
            and reader.classify_non_medicine_name(str(medicine_raw))
        ):
            continue

        if (
            medicine_raw
            and hasattr(reader, "is_plausible_medicine_name")
            and not reader.is_plausible_medicine_name(str(medicine_raw))
        ):
            continue

        if (
            medicine_raw
            and hasattr(reader, "is_suspicious_medicine_name")
            and reader.is_suspicious_medicine_name(str(medicine_raw))
        ):
            medicine_raw = None

            if "medicine_raw" not in uncertain_fields:
                uncertain_fields.append("medicine_raw")

        try:
            source_ocr_confidence = float(
                source.get("ocr_confidence") or 0
            )
        except (TypeError, ValueError):
            source_ocr_confidence = 0.0

        if (
            medicine_raw
            and source_ocr_confidence <= 0
            and "medicine_raw" in uncertain_fields
        ):
            medicine_raw = None

        if medicine_raw and hasattr(
            reader,
            "split_medicine_name_candidates",
        ):
            medicine_raw_candidates = [
                nullable(candidate)
                for candidate in reader.split_medicine_name_candidates(
                    str(medicine_raw)
                )
            ]
        else:
            medicine_raw_candidates = [medicine_raw]

        medicine_raw_candidates = [
            candidate
            for candidate in medicine_raw_candidates
            if candidate is not None
        ]

        if not medicine_raw_candidates:
            medicine_raw_candidates = [None]

        is_compound_candidate = (
            len(
                [
                    candidate
                    for candidate in medicine_raw_candidates
                    if candidate is not None
                ]
            )
            > 1
        )

        formulation_suffix = nullable(
            extracted.get("formulation_suffix")
        )
        strength = nullable(extracted.get("strength"))
        quantity = nullable(extracted.get("quantity"))
        schedule_raw = nullable(extracted.get("schedule_raw"))
        exact_time = nullable(extracted.get("exact_time"))
        food_timing = nullable(extracted.get("food_timing"))
        dosage_form = nullable(extracted.get("dosage_form"))

        for candidate_medicine_raw in medicine_raw_candidates:
            if (
                candidate_medicine_raw
                and hasattr(reader, "classify_non_medicine_name")
                and reader.classify_non_medicine_name(
                    str(candidate_medicine_raw)
                )
            ):
                continue

            if (
                candidate_medicine_raw
                and hasattr(reader, "is_plausible_medicine_name")
                and not reader.is_plausible_medicine_name(
                    str(candidate_medicine_raw)
                )
            ):
                continue

            if (
                candidate_medicine_raw
                and hasattr(reader, "canonical_medicine_key")
            ):
                medicine_key = reader.canonical_medicine_key(
                    str(candidate_medicine_raw)
                )
            else:
                medicine_key = (
                    "".join(
                        ch.lower()
                        for ch in str(candidate_medicine_raw or "")
                        if ch.isalnum()
                    )
                )

            if medicine_key and medicine_key in seen_medicine_keys:
                continue

            if (
                is_compound_candidate
                and medicine_key
                and medicine_key in standalone_medicine_keys
            ):
                continue

            has_visible_medicine_evidence = any(
                value is not None
                for value in (
                    candidate_medicine_raw,
                    dosage_form,
                    formulation_suffix,
                    strength,
                    quantity,
                    schedule_raw,
                    exact_time,
                    food_timing,
                )
            )

            if (
                not has_visible_medicine_evidence
                and is_medicine_row is True
                and "medicine_raw" in uncertain_fields
            ):
                has_visible_medicine_evidence = True

            if not has_visible_medicine_evidence:
                continue

            if medicine_key:
                seen_medicine_keys.add(medicine_key)

            field_status = {
                "medicine_raw": (
                    "uncertain"
                    if "medicine_raw" in uncertain_fields
                    or not candidate_medicine_raw
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

            safe_rows.append(
                {
                    "row": source.get("output_row"),
                    "column": source.get("column"),
                    "ocr_anchor_text": source.get("ocr_anchor_text"),
                    "ocr_confidence": source.get("ocr_confidence"),
                    "medicine": {
                        "line_number": nullable(
                            extracted.get("line_number")
                        ),
                        "dosage_form": dosage_form,
                        "medicine_raw": candidate_medicine_raw,
                        "formulation_suffix": formulation_suffix,
                        "strength": strength,
                        "quantity": quantity,
                        "schedule_raw": schedule_raw,
                        "morning": nullable(
                            extracted.get("morning")
                        ),
                        "afternoon": nullable(
                            extracted.get("afternoon")
                        ),
                        "evening": nullable(
                            extracted.get("evening")
                        ),
                        "exact_time": exact_time,
                        "food_timing": food_timing,
                    },
                    "field_status": field_status,
                    "readable_candidate": (
                        candidate_medicine_raw is not None
                        and field_status["medicine_raw"] == "candidate"
                    ),
                    "review_required": True,
                    "uncertain_fields": uncertain_fields,
                    "evidence": {
                        "name_image": source.get("name_file"),
                        "context_image": source.get("context_file"),
                    },
                }
            )

    safe_payload = {
        "status": "human_review_required",
        "auto_confirmed_count": 0,
        "row_count": len(safe_rows),
        "rows": safe_rows,
    }

    safe_payload_path = output_dir / "safe-review-payload.json"
    safe_payload_path.write_text(
        json.dumps(safe_payload, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    print()
    print("PRESCRIPTION VISION PIPELINE COMPLETE")
    print("-------------------------------------")
    print(f"Rows detected: {len(safe_rows)}")
    print(f"Review JSON:  {safe_payload_path}")
    print(f"Evidence dir: {output_dir}")


if __name__ == "__main__":
    main()
