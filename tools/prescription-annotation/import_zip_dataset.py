from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageFile, ImageOps


ImageFile.LOAD_TRUNCATED_IMAGES = True

IMAGE_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".bmp",
    ".tif",
    ".tiff",
}

CATEGORIES = [
    {
        "id": 1,
        "name": "medicine_name",
        "supercategory": "prescription",
    },
    {
        "id": 2,
        "name": "non_medicine",
        "supercategory": "prescription",
    },
]


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[2]
    default_dataset = repo_root / "datasets" / "prescription_medicine_detection"

    parser = argparse.ArgumentParser(
        description=(
            "Import a zip of prescription images into a local annotation "
            "dataset and optionally generate geometry prelabels."
        )
    )
    parser.add_argument(
        "zip_path",
        type=Path,
        help="Path to the zip containing prescription images.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=default_dataset,
        help=f"Dataset output directory. Default: {default_dataset}",
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help=(
            "Replace the output dataset if it already exists. This deletes "
            "only the selected output directory."
        ),
    )
    parser.add_argument(
        "--no-prelabel",
        action="store_true",
        help="Skip geometry prelabel generation.",
    )
    parser.add_argument(
        "--val-ratio",
        type=float,
        default=0.15,
        help="Validation split ratio. Default: 0.15",
    )
    parser.add_argument(
        "--test-ratio",
        type=float,
        default=0.15,
        help="Test split ratio. Default: 0.15",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Deterministic split seed. Default: 42",
    )
    parser.add_argument(
        "--max-side",
        type=int,
        default=0,
        help=(
            "Resize images whose longest side exceeds this value. "
            "Use 0 to preserve original size. Default: 0"
        ),
    )
    return parser.parse_args()


def ensure_safe_output(output_dir: Path, repo_root: Path) -> Path:
    resolved = output_dir.resolve()
    allowed_root = (repo_root / "datasets").resolve()

    try:
        is_inside = resolved == allowed_root or resolved.is_relative_to(allowed_root)
    except AttributeError:
        is_inside = str(resolved).startswith(str(allowed_root) + os.sep)

    if not is_inside:
        raise RuntimeError(
            "For safety, output must be inside the repository datasets directory: "
            f"{allowed_root}"
        )

    return resolved


def image_entries(zip_path: Path) -> list[zipfile.ZipInfo]:
    with zipfile.ZipFile(zip_path) as archive:
        entries = [
            entry
            for entry in archive.infolist()
            if not entry.is_dir()
            and Path(entry.filename).suffix.lower() in IMAGE_EXTENSIONS
            and "__MACOSX" not in entry.filename
        ]

    return sorted(entries, key=lambda item: item.filename.lower())


def split_for_index(
    index: int,
    total: int,
    *,
    val_ratio: float,
    test_ratio: float,
    seed: int,
) -> str:
    # Stable hash-based split so adding/removing one image changes very little.
    digest = hashlib.sha256(f"{seed}:{index}".encode("utf-8")).digest()
    value = int.from_bytes(digest[:8], "big") / float(2**64 - 1)

    if value < test_ratio:
        return "test"

    if value < test_ratio + val_ratio:
        return "val"

    return "train"


def load_normalized_image(
    archive: zipfile.ZipFile,
    entry: zipfile.ZipInfo,
    *,
    max_side: int,
) -> Image.Image:
    with archive.open(entry) as handle:
        image = Image.open(handle)
        image.load()

    image = ImageOps.exif_transpose(image).convert("RGB")

    if max_side > 0:
        width, height = image.size
        longest = max(width, height)

        if longest > max_side:
            scale = max_side / float(longest)
            image = image.resize(
                (
                    max(1, int(width * scale)),
                    max(1, int(height * scale)),
                ),
                Image.Resampling.LANCZOS,
            )

    return image


def write_dataset(args: argparse.Namespace) -> Path:
    repo_root = Path(__file__).resolve().parents[2]
    zip_path = args.zip_path.resolve()
    output_dir = ensure_safe_output(args.output, repo_root)

    if not zip_path.exists():
        raise FileNotFoundError(f"Zip not found: {zip_path}")

    if output_dir.exists():
        if not args.replace:
            raise RuntimeError(
                f"Dataset already exists: {output_dir}\n"
                "Use --replace only when you intentionally want to recreate it."
            )
        shutil.rmtree(output_dir)

    images_dir = output_dir / "images" / "raw"
    annotations_dir = output_dir / "annotations"
    images_dir.mkdir(parents=True, exist_ok=True)
    annotations_dir.mkdir(parents=True, exist_ok=True)

    entries = image_entries(zip_path)

    if not entries:
        raise RuntimeError(f"No supported image files found in {zip_path}")

    now = datetime.now(timezone.utc).isoformat()
    manifest_images = []
    coco_images = []
    skipped = []

    with zipfile.ZipFile(zip_path) as archive:
        for index, entry in enumerate(entries, start=1):
            output_name = f"prescription_{index:04d}.jpg"
            output_path = images_dir / output_name

            try:
                image = load_normalized_image(
                    archive,
                    entry,
                    max_side=args.max_side,
                )
            except Exception as error:
                skipped.append(
                    {
                        "source_entry": entry.filename,
                        "reason": str(error),
                    }
                )
                continue

            image.save(output_path, format="JPEG", quality=95, optimize=True)
            width, height = image.size
            digest = hashlib.sha256(output_path.read_bytes()).hexdigest()
            split = split_for_index(
                index,
                len(entries),
                val_ratio=args.val_ratio,
                test_ratio=args.test_ratio,
                seed=args.seed,
            )
            image_id = len(manifest_images) + 1
            image_record = {
                "id": image_id,
                "file_name": output_name,
                "width": width,
                "height": height,
                "split": split,
                "source_zip": str(zip_path),
                "source_entry": entry.filename,
                "sha256": digest,
                "annotation_status": "needs_review",
                "privacy": "contains_sensitive_medical_document",
            }

            manifest_images.append(image_record)
            coco_images.append(
                {
                    "id": image_id,
                    "file_name": output_name,
                    "width": width,
                    "height": height,
                    "split": split,
                    "source_entry": entry.filename,
                }
            )

    manifest = {
        "dataset": output_dir.name,
        "created_at": now,
        "source": {
            "archive": str(zip_path),
            "count": len(manifest_images),
            "skipped": skipped,
        },
        "categories": CATEGORIES,
        "images": manifest_images,
    }
    coco = {
        "info": {
            "description": "Medicine-name detection boxes for full prescription images",
            "version": "0.1.0",
            "created_at": now,
            "source_archive": str(zip_path),
        },
        "licenses": [],
        "images": coco_images,
        "annotations": [],
        "categories": CATEGORIES,
        "image_statuses": {},
    }

    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2),
        encoding="utf-8",
    )
    (annotations_dir / "medicine_boxes.coco.json").write_text(
        json.dumps(coco, indent=2),
        encoding="utf-8",
    )

    if not args.no_prelabel:
        prelabel_script = Path(__file__).with_name("auto_prelabel_geometry.py")
        subprocess.run(
            [
                sys.executable,
                str(prelabel_script),
                str(output_dir),
            ],
            check=True,
        )

    return output_dir


def main() -> None:
    args = parse_args()
    output_dir = write_dataset(args)

    print()
    print("Prescription dataset import complete")
    print("-----------------------------------")
    print(f"Dataset: {output_dir}")
    print(f"Manifest: {output_dir / 'manifest.json'}")
    print(f"Annotations: {output_dir / 'annotations' / 'medicine_boxes.coco.json'}")
    print()
    print("Open the annotator with:")
    print(f"node tools\\prescription-annotation\\server.mjs {output_dir}")


if __name__ == "__main__":
    main()
