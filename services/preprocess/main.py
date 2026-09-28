"""Portable, stateless OCR evidence service for MediTrack.

The service extracts text and geometry only. It never resolves a medicine,
creates a schedule, or confirms a clinical fact.
"""
from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import re
import secrets
import time
from contextlib import asynccontextmanager
from functools import lru_cache
from typing import Annotated, Any

import cv2
import fitz
import numpy as np
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response
from PIL import Image, ImageOps, UnidentifiedImageError

from preprocessing import (
    ImageVariant,
    build_ocr_variants,
    is_reversed_bill_layout,
    is_vertical_text_layout,
    preprocess_image,
    rotate_line_geometry_180,
)

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("meditrack.ocr")

MAX_UPLOAD_BYTES = int(os.getenv("OCR_MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
MAX_IMAGE_PIXELS = int(os.getenv("OCR_MAX_IMAGE_PIXELS", "25000000"))
OCR_CONCURRENCY = max(1, int(os.getenv("OCR_CONCURRENCY", "1")))
OCR_TIMEOUT_SECONDS = float(os.getenv("OCR_SIDECAR_TIMEOUT_SECONDS", "120"))
OCR_MAX_VARIANTS = max(1, min(4, int(os.getenv("OCR_MAX_VARIANTS", "4"))))
OCR_VARIANT_BUDGET_SECONDS = max(
    15.0, float(os.getenv("OCR_VARIANT_BUDGET_SECONDS", "90"))
)
OCR_MAX_PDF_PAGES = max(1, min(8, int(os.getenv("OCR_MAX_PDF_PAGES", "4"))))
OCR_EAGER_LOAD = os.getenv("OCR_EAGER_LOAD", "false").lower() == "true"
OCR_SERVICE_TOKEN = os.getenv("OCR_SERVICE_TOKEN", "").strip()
OCR_REQUIRE_TOKEN = os.getenv("OCR_REQUIRE_TOKEN", "false").lower() == "true"

PADDLE_DEVICE = os.getenv("PADDLE_DEVICE", "cpu").strip() or "cpu"
PADDLE_ENABLE_MKLDNN = (
    os.getenv("PADDLE_ENABLE_MKLDNN", "false").strip().lower() == "true"
)
PADDLE_DET_MODEL = os.getenv("PADDLE_DET_MODEL", "PP-OCRv6_medium_det").strip()
PADDLE_REC_MODEL = os.getenv("PADDLE_REC_MODEL", "PP-OCRv6_medium_rec").strip()
PADDLE_DET_MODEL_DIR = os.getenv("PADDLE_DET_MODEL_DIR", "").strip()
PADDLE_REC_MODEL_DIR = os.getenv("PADDLE_REC_MODEL_DIR", "").strip()

ALLOWED_DOCUMENT_TYPES = {"generic", "package", "bill", "prescription"}
MEDICATION_CUE = re.compile(
    r"\b(?:tab(?:let)?s?|cap(?:sule)?s?|syr(?:up)?|inj(?:ection)?|drops?|cream|"
    r"ointment|suspension|\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|iu|units?|%w/[wv])|"
    r"od|bd|bid|tds|tid|qid|sos|prn)\b",
    re.IGNORECASE,
)

Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
_ocr_semaphore = asyncio.Semaphore(OCR_CONCURRENCY)
_model_error: str | None = None


@lru_cache(maxsize=1)
def _get_ocr():
    """Create one reusable PaddleOCR 3.x instance.

    Empty model-directory settings intentionally allow PaddleOCR to download
    and cache the official model on first start. No host-specific paths are
    baked into the image.
    """
    global _model_error
    from paddleocr import PaddleOCR

    options: dict[str, Any] = {
        "text_detection_model_name": PADDLE_DET_MODEL,
        "text_recognition_model_name": PADDLE_REC_MODEL,
        "use_doc_orientation_classify": False,
        "use_doc_unwarping": False,
        "use_textline_orientation": True,
        "device": PADDLE_DEVICE,
        # PaddleOCR 3.7.0 + PaddlePaddle 3.3.1 currently raises inside the
        # oneDNN/PIR executor for PP-OCRv6 CPU inference. Keep the portable
        # standard CPU kernels as the safe default until upstream resolves it.
        "enable_mkldnn": PADDLE_ENABLE_MKLDNN,
    }
    if PADDLE_DET_MODEL_DIR:
        options["text_detection_model_dir"] = PADDLE_DET_MODEL_DIR
    if PADDLE_REC_MODEL_DIR:
        options["text_recognition_model_dir"] = PADDLE_REC_MODEL_DIR

    logger.info(
        "Loading PaddleOCR device=%s detection=%s recognition=%s",
        PADDLE_DEVICE,
        PADDLE_DET_MODEL,
        PADDLE_REC_MODEL,
    )
    try:
        engine = PaddleOCR(**options)
        _model_error = None
        return engine
    except Exception as exc:
        _model_error = type(exc).__name__
        raise


@asynccontextmanager
async def lifespan(_: FastAPI):
    if OCR_REQUIRE_TOKEN and not OCR_SERVICE_TOKEN:
        raise RuntimeError("OCR_REQUIRE_TOKEN=true but OCR_SERVICE_TOKEN is empty")
    if OCR_EAGER_LOAD:
        await asyncio.to_thread(_verify_inference)
    yield


app = FastAPI(
    title="MediTrack PP-OCRv6 evidence service",
    version="3.0.0",
    lifespan=lifespan,
)


def _authorize(
    supplied: Annotated[str | None, Header(alias="X-OCR-Service-Token")] = None,
) -> None:
    if not OCR_SERVICE_TOKEN:
        if OCR_REQUIRE_TOKEN:
            raise HTTPException(status_code=503, detail="OCR service token is missing")
        return
    if not supplied or not secrets.compare_digest(supplied, OCR_SERVICE_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid OCR service token")


async def _read_bounded(file: UploadFile) -> bytes:
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds upload limit")
    return raw


def _decode(raw: bytes) -> np.ndarray:
    """Decode while honoring camera EXIF orientation before OpenCV work."""
    try:
        with Image.open(io.BytesIO(raw)) as source:
            oriented = ImageOps.exif_transpose(source)
            width, height = oriented.size
            if width < 64 or height < 64:
                raise HTTPException(status_code=400, detail="Image resolution is too small")
            if width * height > MAX_IMAGE_PIXELS:
                raise HTTPException(status_code=413, detail="Decoded image exceeds pixel limit")
            rgb = np.asarray(oriented.convert("RGB"))
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Unsupported or corrupt image") from exc
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)


def _decode_for_ocr(raw: bytes, document_type: str) -> list[np.ndarray]:
    if not raw.startswith(b"%PDF"):
        return [_decode(raw)]
    if document_type != "bill":
        raise HTTPException(
            status_code=400,
            detail="PDF OCR is supported only for printed bills",
        )

    try:
        document = fitz.open(stream=raw, filetype="pdf")
    except (fitz.FileDataError, RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Unsupported or corrupt PDF") from exc

    try:
        if document.page_count < 1:
            raise HTTPException(status_code=400, detail="PDF contains no pages")
        if document.page_count > OCR_MAX_PDF_PAGES:
            raise HTTPException(
                status_code=400,
                detail=f"PDF exceeds the {OCR_MAX_PDF_PAGES}-page OCR limit",
            )

        images: list[np.ndarray] = []
        total_pixels = 0
        for page_number in range(document.page_count):
            page = document.load_page(page_number)
            pixmap = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0), alpha=False)
            total_pixels += pixmap.width * pixmap.height
            if total_pixels > MAX_IMAGE_PIXELS:
                raise HTTPException(
                    status_code=413,
                    detail="Rendered PDF exceeds pixel limit",
                )
            rgb = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(
                pixmap.height,
                pixmap.width,
                pixmap.n,
            )
            if pixmap.n == 4:
                rgb = cv2.cvtColor(rgb, cv2.COLOR_RGBA2RGB)
            images.append(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
        return images
    finally:
        document.close()


def _read_result(result: Any) -> dict[str, Any]:
    if isinstance(result, dict):
        data = result
    else:
        data = getattr(result, "json", {})
        if callable(data):
            data = data()
    if isinstance(data, str):
        data = json.loads(data)
    if not isinstance(data, dict):
        return {}
    payload = data.get("res", data)
    return payload if isinstance(payload, dict) else {}


def _bbox_from_polygon(polygon: Any) -> list[list[float]] | None:
    points = np.asarray(polygon, dtype=np.float32)
    if points.size < 4:
        return None
    if points.ndim == 1 and points.size == 4:
        x1, y1, x2, y2 = points.tolist()
        return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]
    points = points.reshape(-1, 2)
    x1, y1 = points.min(axis=0).tolist()
    x2, y2 = points.max(axis=0).tolist()
    return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]


def _sort_lines(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not lines:
        return []
    heights = [max(1.0, line["bbox"][2][1] - line["bbox"][0][1]) for line in lines]
    row_tolerance = max(8.0, float(np.median(heights)) * 0.65)
    return sorted(
        lines,
        key=lambda line: (
            round(line["bbox"][0][1] / row_tolerance),
            line["bbox"][0][0],
        ),
    )


def _run_paddle(variant: ImageVariant) -> list[dict[str, Any]]:
    image = np.ascontiguousarray(variant.image, dtype=np.uint8)
    results = _get_ocr().predict(image)
    lines: list[dict[str, Any]] = []
    for result in results or []:
        payload = _read_result(result)
        texts = list(payload.get("rec_texts", []))
        scores = list(payload.get("rec_scores", []))
        polygons = list(payload.get("rec_polys", payload.get("rec_boxes", [])))
        for index, text in enumerate(texts):
            clean_text = " ".join(str(text or "").split())
            if not clean_text:
                continue
            score = float(scores[index]) if index < len(scores) else 0.0
            bbox = _bbox_from_polygon(polygons[index]) if index < len(polygons) else None
            if bbox is None:
                continue
            lines.append(
                {
                    "text": clean_text,
                    "confidence": round(max(0.0, min(1.0, score)), 4),
                    "bbox": bbox,
                    "variant": variant.name,
                }
            )
    return _sort_lines(lines)


@lru_cache(maxsize=1)
def _verify_inference() -> int:
    """Prove that the loaded model can execute, not merely initialize."""
    probe = np.full((180, 720, 3), 255, dtype=np.uint8)
    cv2.putText(
        probe,
        "MEDICINE 500 mg",
        (24, 112),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.8,
        (0, 0, 0),
        4,
        cv2.LINE_AA,
    )
    lines = _run_paddle(ImageVariant("readiness", probe))
    if not lines:
        raise RuntimeError("OCR inference readiness probe returned no text")
    return len(lines)


def _quality(lines: list[dict[str, Any]], document_type: str) -> dict[str, Any]:
    text = "\n".join(line["text"] for line in lines).strip()
    text_length = len(text)
    alphanumeric = sum(character.isalnum() for character in text)
    alphanumeric_ratio = alphanumeric / max(1, text_length)
    confidence_weights = [
        max(1, sum(character.isalnum() for character in line["text"]))
        for line in lines
    ]
    average = (
        sum(
            float(line["confidence"]) * confidence_weights[index]
            for index, line in enumerate(lines)
        )
        / sum(confidence_weights)
        if lines
        else 0.0
    )
    medication_cue = bool(MEDICATION_CUE.search(text))
    minimum_confidence = {
        "package": 0.48,
        "bill": 0.45,
        "prescription": 0.30,
        "generic": 0.42,
    }[document_type]
    reliable_brand_line = document_type == "package" and any(
        float(line["confidence"]) >= 0.72
        and bool(re.search(r"\b[A-Za-z][A-Za-z0-9-]{3,}\b", line["text"]))
        for line in lines
    )
    minimum_length = 4 if reliable_brand_line else (10 if document_type == "package" else 14)

    reasons: list[str] = []
    if text_length < minimum_length:
        reasons.append("insufficient_text")
    if average < minimum_confidence:
        reasons.append("low_average_confidence")
    if alphanumeric_ratio < 0.45:
        reasons.append("low_alphanumeric_ratio")
    if document_type == "package" and not medication_cue and average < 0.65:
        reasons.append("no_medication_signal")

    score = (
        0.55 * average
        + 0.2 * min(text_length / 160.0, 1.0)
        + 0.15 * min(len(lines) / 8.0, 1.0)
        + 0.1 * (1.0 if medication_cue else 0.0)
    )
    return {
        "accepted": not reasons,
        "score": round(score, 4),
        "reason": reasons[0] if reasons else None,
        "reasons": reasons,
        "textLength": text_length,
        "alphanumericRatio": round(alphanumeric_ratio, 4),
        "medicationSignal": medication_cue,
    }


def _recognize(image: np.ndarray, document_type: str) -> dict[str, Any]:
    diagnostics: list[dict[str, Any]] = []
    best: dict[str, Any] | None = None
    recognition_started = time.perf_counter()
    for variant in build_ocr_variants(image, document_type, OCR_MAX_VARIANTS):
        started = time.perf_counter()
        orientation_corrected = False
        try:
            lines = _run_paddle(variant)
            quality = _quality(lines, document_type)
            if (
                variant.name == "original"
                and document_type in {"bill", "package"}
                and is_vertical_text_layout(lines)
            ):
                rotated_variant = ImageVariant(
                    "original-rotated-90",
                    cv2.rotate(variant.image, cv2.ROTATE_90_CLOCKWISE),
                )
                rotated_lines = _run_paddle(rotated_variant)
                rotated_quality = _quality(rotated_lines, document_type)
                if rotated_quality["accepted"]:
                    if (
                        document_type == "bill"
                        and is_reversed_bill_layout(rotated_lines)
                    ):
                        rotated_lines = rotate_line_geometry_180(
                            rotated_lines,
                            rotated_variant.image.shape[1],
                            rotated_variant.image.shape[0],
                        )
                    variant = rotated_variant
                    lines = rotated_lines
                    quality = rotated_quality
                    orientation_corrected = True
                    logger.info(
                        "OCR orientation corrected documentType=%s lines=%s",
                        document_type,
                        len(lines),
                    )
            error = None
        except Exception as exc:
            lines = []
            quality = _quality([], document_type)
            error = type(exc).__name__
            logger.exception(
                "OCR variant failed documentType=%s variant=%s error=%s",
                document_type,
                variant.name,
                error,
            )
        duration_ms = round((time.perf_counter() - started) * 1000)
        diagnostics.append(
            {
                "variant": variant.name,
                "success": error is None,
                "lineCount": len(lines),
                "textLength": quality["textLength"],
                "qualityScore": quality["score"],
                "accepted": quality["accepted"],
                "orientationCorrected": orientation_corrected,
                "processingMs": duration_ms,
                "error": error,
            }
        )
        candidate = {"variant": variant.name, "lines": lines, "quality": quality}
        if best is None or (
            bool(quality["accepted"]),
            quality["score"],
        ) > (
            bool(best["quality"]["accepted"]),
            best["quality"]["score"],
        ):
            best = candidate

        # Printed documents usually need only the original or contrast pass.
        # Stop once the quality gate accepts enough evidence instead of paying
        # for every glare/threshold fallback on CPU.
        if (
            document_type in {"bill", "package"}
            and quality["accepted"]
            and (
                quality["textLength"] >= 24
                or quality["score"] >= 0.62
            )
        ):
            break

        if (
            time.perf_counter() - recognition_started
            >= OCR_VARIANT_BUDGET_SECONDS
        ):
            logger.warning(
                "OCR variant budget reached documentType=%s variants=%s",
                document_type,
                len(diagnostics),
            )
            break

    if best is None:
        best = {"variant": "none", "lines": [], "quality": _quality([], document_type)}
    best["variants"] = diagnostics
    best["engineFailure"] = bool(diagnostics) and all(
        not diagnostic["success"] for diagnostic in diagnostics
    )
    return best


def _recognize_pages(
    images: list[np.ndarray], document_type: str
) -> dict[str, Any]:
    if len(images) == 1:
        return _recognize(images[0], document_type)

    page_results = [_recognize(image, document_type) for image in images]
    accepted_lines: list[dict[str, Any]] = []
    variants: list[dict[str, Any]] = []
    selected_variants: list[str] = []

    for page_index, result in enumerate(page_results, start=1):
        selected_variants.append(f"p{page_index}:{result['variant']}")
        variants.extend(
            {**diagnostic, "page": page_index}
            for diagnostic in result["variants"]
        )
        if not result["quality"]["accepted"]:
            continue
        accepted_lines.extend(
            {**line, "page": page_index}
            for line in result["lines"]
        )

    if accepted_lines:
        return {
            "variant": ",".join(selected_variants),
            "lines": accepted_lines,
            "quality": _quality(accepted_lines, document_type),
            "variants": variants,
            "engineFailure": False,
        }

    best = max(
        page_results,
        key=lambda result: (
            bool(result["quality"]["accepted"]),
            result["quality"]["score"],
        ),
    )
    return {
        **best,
        "variant": ",".join(selected_variants),
        "variants": variants,
        "engineFailure": all(result.get("engineFailure") for result in page_results),
    }


@app.get("/health/live")
def health_live() -> dict[str, Any]:
    return {"status": "ok", "service": "meditrack-ocr", "version": "3.0.0"}


@app.get("/health/ready")
async def health_ready() -> dict[str, Any]:
    try:
        probe_line_count = await asyncio.to_thread(_verify_inference)
    except Exception as exc:
        logger.error("OCR readiness failed error=%s", type(exc).__name__)
        raise HTTPException(status_code=503, detail="OCR model is not ready") from exc
    return {
        "status": "ready",
        "device": PADDLE_DEVICE,
        "inferenceVerified": True,
        "probeLineCount": probe_line_count,
        "detectionModel": PADDLE_DET_MODEL,
        "recognitionModel": PADDLE_REC_MODEL,
    }


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok" if _model_error is None else "degraded",
        "service": "meditrack-ocr",
        "modelLoaded": _get_ocr.cache_info().currsize > 0,
        "modelError": _model_error,
        "device": PADDLE_DEVICE,
    }


@app.post("/preprocess", dependencies=[Depends(_authorize)])
async def preprocess(file: UploadFile = File(...)) -> Response:
    raw = await _read_bounded(file)
    processed = await asyncio.to_thread(preprocess_image, _decode(raw), binarize=True)
    encoded, buffer = cv2.imencode(".png", processed)
    if not encoded:
        raise HTTPException(status_code=500, detail="Failed to encode result")
    return Response(content=buffer.tobytes(), media_type="image/png")


@app.post("/ocr", dependencies=[Depends(_authorize)])
async def ocr(
    file: UploadFile = File(...),
    document_type: Annotated[str, Form(alias="documentType")] = "generic",
) -> JSONResponse:
    normalized_type = document_type.strip().lower()
    if normalized_type not in ALLOWED_DOCUMENT_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported document type")

    raw = await _read_bounded(file)
    images = await asyncio.to_thread(_decode_for_ocr, raw, normalized_type)
    started = time.perf_counter()
    try:
        async with _ocr_semaphore:
            selected = await asyncio.wait_for(
                asyncio.to_thread(_recognize_pages, images, normalized_type),
                timeout=OCR_TIMEOUT_SECONDS,
            )
    except asyncio.TimeoutError as exc:
        logger.warning("OCR failed documentType=%s reason=timeout", normalized_type)
        raise HTTPException(status_code=504, detail="OCR engine timeout") from exc
    except Exception as exc:
        logger.exception("OCR engine failed documentType=%s", normalized_type)
        raise HTTPException(status_code=503, detail="OCR engine unavailable") from exc

    lines = selected["lines"]
    quality = selected["quality"]
    raw_text = "\n".join(line["text"] for line in lines).strip()
    confidences = [float(line["confidence"]) for line in lines]
    average_confidence = (
        round(100.0 * sum(confidences) / len(confidences), 2) if confidences else 0.0
    )
    processing_ms = round((time.perf_counter() - started) * 1000)
    success = bool(quality["accepted"])
    fallback_reason = (
        "engine_error" if selected.get("engineFailure") else quality["reason"]
    )

    logger.info(
        "OCR complete source=PP_OCRV6 success=%s documentType=%s variant=%s "
        "textLength=%s lineCount=%s confidence=%.2f durationMs=%s fallbackReason=%s",
        success,
        normalized_type,
        selected["variant"],
        len(raw_text),
        len(lines),
        average_confidence,
        processing_ms,
        fallback_reason,
    )

    return JSONResponse(
        {
            "success": success,
            "source": "SERVER_OCR" if success else "NO_RESULT",
            "engine": "paddleocr",
            "modelVersion": f"{PADDLE_DET_MODEL}+{PADDLE_REC_MODEL}",
            "documentType": normalized_type,
            "selectedVariant": selected["variant"],
            "rawText": raw_text if success else "",
            "avgConfidence": average_confidence,
            "wordsCount": len(raw_text.split()) if success else 0,
            "lines": lines if success else [],
            "quality": quality,
            "variants": selected["variants"],
            "processingMs": processing_ms,
            "fallbackReason": fallback_reason if not success else None,
        }
    )
