"""Bounded image preparation for the MediTrack OCR sidecar.

Several conservative variants are retained because foil packaging and faint
handwriting react differently to thresholding. Enhanced pixels never replace
the original evidence.
"""
from __future__ import annotations

from dataclasses import dataclass
import re

import cv2
import numpy as np

TARGET_LONG_EDGE = 2200
PRINTED_TARGET_LONG_EDGE = 1800
MAX_LONG_EDGE = 3000
MAX_UPSCALE = 3.0


@dataclass(frozen=True)
class ImageVariant:
    name: str
    image: np.ndarray


def is_vertical_text_layout(lines: list[dict]) -> bool:
    """Detect a quarter-turned document from OCR geometry, not filename hints."""
    weighted_total = 0
    weighted_vertical = 0
    positioned_lines = 0

    for line in lines:
        bbox = line.get("bbox")
        if not isinstance(bbox, list) or len(bbox) < 4:
            continue
        try:
            xs = [float(point[0]) for point in bbox]
            ys = [float(point[1]) for point in bbox]
        except (IndexError, TypeError, ValueError):
            continue
        width = max(xs) - min(xs)
        height = max(ys) - min(ys)
        if width <= 0 or height <= 0:
            continue

        weight = max(
            1,
            sum(character.isalnum() for character in str(line.get("text", ""))),
        )
        positioned_lines += 1
        weighted_total += weight
        if height > width * 1.35:
            weighted_vertical += weight

    return (
        positioned_lines >= 3
        and weighted_total >= 15
        and weighted_vertical / weighted_total >= 0.65
    )


def is_reversed_bill_layout(lines: list[dict]) -> bool:
    """Detect amount columns appearing before identity columns after rotation."""

    def centers(pattern: str) -> list[float]:
        values: list[float] = []
        for line in lines:
            if not re.search(pattern, str(line.get("text", "")), re.IGNORECASE):
                continue
            bbox = line.get("bbox")
            if not isinstance(bbox, list) or len(bbox) < 4:
                continue
            try:
                xs = [float(point[0]) for point in bbox]
            except (IndexError, TypeError, ValueError):
                continue
            values.append((min(xs) + max(xs)) / 2)
        return values

    identity = centers(r"\b(?:description|discription|product|item|mfg)\b")
    financial = centers(r"\b(?:amount|rate|qty|quantity)\b")
    if not identity or not financial:
        return False
    return sum(financial) / len(financial) < sum(identity) / len(identity)


def rotate_line_geometry_180(
    lines: list[dict], width: int, height: int
) -> list[dict]:
    rotated: list[dict] = []
    for line in lines:
        bbox = line.get("bbox")
        if not isinstance(bbox, list) or len(bbox) < 4:
            rotated.append(dict(line))
            continue
        rotated.append(
            {
                **line,
                "bbox": [
                    [width - float(point[0]), height - float(point[1])]
                    for point in bbox
                ],
            }
        )
    return rotated


def _resize_bounded(
    img: np.ndarray, target_long_edge: int = TARGET_LONG_EDGE
) -> np.ndarray:
    height, width = img.shape[:2]
    long_edge = max(height, width)
    if long_edge < target_long_edge:
        scale = min(target_long_edge / float(long_edge), MAX_UPSCALE)
    elif long_edge > MAX_LONG_EDGE:
        scale = MAX_LONG_EDGE / float(long_edge)
    else:
        return img

    interpolation = cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA
    return cv2.resize(
        img,
        (max(1, round(width * scale)), max(1, round(height * scale))),
        interpolation=interpolation,
    )


def _to_gray(img: np.ndarray) -> np.ndarray:
    if img.ndim == 2:
        return img
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def _deskew(img: np.ndarray) -> np.ndarray:
    gray = _to_gray(img)
    threshold = cv2.threshold(
        cv2.bitwise_not(gray),
        0,
        255,
        cv2.THRESH_BINARY | cv2.THRESH_OTSU,
    )[1]
    coordinates = np.column_stack(np.where(threshold > 0))[:, ::-1]
    if coordinates.shape[0] < 30:
        return img

    angle = cv2.minAreaRect(coordinates.astype(np.float32))[-1]
    angle = -(90 + angle) if angle < -45 else -angle
    if abs(angle) < 0.5 or abs(angle) > 15:
        return img

    height, width = img.shape[:2]
    matrix = cv2.getRotationMatrix2D((width / 2, height / 2), angle, 1.0)
    return cv2.warpAffine(
        img,
        matrix,
        (width, height),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE,
    )


def _order_points(points: np.ndarray) -> np.ndarray:
    ordered = np.zeros((4, 2), dtype=np.float32)
    sums = points.sum(axis=1)
    differences = np.diff(points, axis=1).reshape(-1)
    ordered[0] = points[np.argmin(sums)]
    ordered[2] = points[np.argmax(sums)]
    ordered[1] = points[np.argmin(differences)]
    ordered[3] = points[np.argmax(differences)]
    return ordered


def _perspective_crop(img: np.ndarray) -> np.ndarray:
    """Rectify a clear page/strip contour and otherwise preserve the image."""
    gray = _to_gray(img)
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 50, 150)
    contours, _ = cv2.findContours(
        edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE
    )
    image_area = float(img.shape[0] * img.shape[1])

    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:8]:
        area_ratio = cv2.contourArea(contour) / max(image_area, 1.0)
        if area_ratio < 0.28 or area_ratio > 0.98:
            continue
        perimeter = cv2.arcLength(contour, True)
        polygon = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
        if len(polygon) != 4:
            continue

        rect = _order_points(polygon.reshape(4, 2).astype(np.float32))
        top_left, top_right, bottom_right, bottom_left = rect
        width = int(
            max(
                np.linalg.norm(bottom_right - bottom_left),
                np.linalg.norm(top_right - top_left),
            )
        )
        height = int(
            max(
                np.linalg.norm(top_right - bottom_right),
                np.linalg.norm(top_left - bottom_left),
            )
        )
        if width < 128 or height < 128:
            continue

        destination = np.array(
            [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]],
            dtype=np.float32,
        )
        transform = cv2.getPerspectiveTransform(rect, destination)
        return cv2.warpPerspective(
            img,
            transform,
            (width, height),
            flags=cv2.INTER_CUBIC,
            borderMode=cv2.BORDER_REPLICATE,
        )

    return img


def _contrast_variant(img: np.ndarray) -> np.ndarray:
    gray = _to_gray(img)
    denoised = cv2.bilateralFilter(gray, 7, 45, 45)
    contrasted = cv2.createCLAHE(
        clipLimit=2.2, tileGridSize=(8, 8)
    ).apply(denoised)
    sharpened = cv2.addWeighted(
        contrasted,
        1.45,
        cv2.GaussianBlur(contrasted, (0, 0), 1.1),
        -0.45,
        0,
    )
    return cv2.cvtColor(sharpened, cv2.COLOR_GRAY2BGR)


def _illumination_variant(img: np.ndarray) -> np.ndarray:
    """Normalize uneven paper lighting and foil glare without inventing text."""
    gray = _to_gray(img)
    background = cv2.GaussianBlur(gray, (0, 0), sigmaX=25, sigmaY=25)
    normalized = cv2.divide(gray, np.maximum(background, 1), scale=210)
    normalized = cv2.normalize(normalized, None, 0, 255, cv2.NORM_MINMAX)
    normalized = cv2.medianBlur(normalized.astype(np.uint8), 3)
    return cv2.cvtColor(normalized, cv2.COLOR_GRAY2BGR)


def _threshold_variant(img: np.ndarray) -> np.ndarray:
    thresholded = cv2.adaptiveThreshold(
        _to_gray(img),
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        blockSize=31,
        C=13,
    )
    return cv2.cvtColor(thresholded, cv2.COLOR_GRAY2BGR)


def build_ocr_variants(
    img: np.ndarray,
    document_type: str = "generic",
    max_variants: int = 4,
) -> list[ImageVariant]:
    if img.ndim != 3 or img.shape[2] != 3:
        raise ValueError("OCR input must be a BGR image")

    document_type = (document_type or "generic").strip().lower()
    target_long_edge = (
        PRINTED_TARGET_LONG_EDGE
        if document_type in {"bill", "package"}
        else TARGET_LONG_EDGE
    )
    base = _resize_bounded(
        _deskew(_perspective_crop(img)), target_long_edge
    )
    candidates = [
        ImageVariant("original", base),
        ImageVariant("contrast", _contrast_variant(base)),
        ImageVariant("illumination", _illumination_variant(base)),
        ImageVariant("threshold", _threshold_variant(base)),
    ]

    return candidates[: max(1, min(max_variants, len(candidates)))]


def preprocess_image(img: np.ndarray, *, binarize: bool = True) -> np.ndarray:
    """Compatibility helper used by the existing `/preprocess` route."""
    base = _resize_bounded(_deskew(_perspective_crop(img)))
    return _threshold_variant(base) if binarize else _contrast_variant(base)
