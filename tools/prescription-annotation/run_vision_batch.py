from __future__ import annotations

import argparse
import csv
import html
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[2]
    default_dataset = repo_root / "datasets" / "prescription_medicine_detection"
    default_output = default_dataset / "exports" / "vision_batch"

    parser = argparse.ArgumentParser(
        description=(
            "Run the local prescription vision pipeline over a dataset and "
            "write a review report."
        )
    )
    parser.add_argument(
        "--dataset",
        type=Path,
        default=default_dataset,
        help=f"Dataset directory. Default: {default_dataset}",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=default_output,
        help=f"Batch output directory. Default: {default_output}",
    )
    parser.add_argument(
        "--model",
        default="qwen3-vl:2b-instruct",
        help="Ollama vision model to use.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Run only the first N selected images. Use 0 for all.",
    )
    parser.add_argument(
        "--start",
        type=int,
        default=1,
        help="Start from this 1-based image position in manifest order.",
    )
    parser.add_argument(
        "--image-id",
        type=int,
        action="append",
        default=[],
        help="Run only specific manifest image id(s). Can be repeated.",
    )
    parser.add_argument(
        "--split",
        choices=["train", "val", "test"],
        default=None,
        help="Run only one split.",
    )
    parser.add_argument(
        "--timeout-minutes",
        type=float,
        default=8.0,
        help="Timeout per prescription. Default: 8 minutes.",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Skip images with an existing completed safe-review-payload.json.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-run selected images even when previous outputs exist.",
    )
    parser.add_argument(
        "--qwen-name-batch-size",
        type=int,
        default=3,
        help="Override MEDITRACK_QWEN_NAME_BATCH_SIZE. Default: 3.",
    )
    parser.add_argument(
        "--single-fallback-limit",
        type=int,
        default=1,
        help="Override MEDITRACK_QWEN_SINGLE_FALLBACK_LIMIT. Default: 1 for batch speed.",
    )
    return parser.parse_args()


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def safe_read_json(path: Path):
    try:
        return read_json(path)
    except (OSError, json.JSONDecodeError):
        return None


def process_output_text(value) -> str:
    if value is None:
        return ""

    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")

    return str(value)


def selected_images(manifest: dict, args: argparse.Namespace) -> list[dict]:
    images = list(manifest.get("images") or [])

    if args.image_id:
        allowed = set(args.image_id)
        images = [image for image in images if int(image.get("id") or 0) in allowed]

    if args.split:
        images = [image for image in images if image.get("split") == args.split]

    if not args.image_id and args.start > 1:
        images = images[args.start - 1 :]

    if args.limit > 0:
        images = images[: args.limit]

    return images


def output_dir_for_image(root: Path, image: dict) -> Path:
    image_id = int(image["id"])
    stem = Path(str(image["file_name"])).stem
    return root / f"{image_id:04d}_{stem}"


def summarize_payload(payload: dict | None) -> dict:
    if not isinstance(payload, dict):
        return {
            "row_count": 0,
            "readable_count": 0,
            "uncertain_count": 0,
            "medicine_names": [],
        }

    rows = payload.get("rows") or []
    medicine_names: list[str] = []
    readable_count = 0
    uncertain_count = 0

    for row in rows:
        medicine = row.get("medicine") or {}
        name = medicine.get("medicine_raw")

        if name:
            medicine_names.append(str(name))

        if row.get("readable_candidate") is True:
            readable_count += 1

        if row.get("uncertain_fields"):
            uncertain_count += 1

    return {
        "row_count": int(payload.get("row_count") or len(rows)),
        "readable_count": readable_count,
        "uncertain_count": uncertain_count,
        "medicine_names": medicine_names,
    }


def summarize_metadata(metadata: list | None) -> dict:
    if not isinstance(metadata, list):
        return {
            "detector_rows": 0,
            "crop_modes": "",
            "sparse_body_rows": 0,
        }

    modes: dict[str, int] = {}

    for row in metadata:
        mode = str(row.get("crop_mode") or "row")
        modes[mode] = modes.get(mode, 0) + 1

    return {
        "detector_rows": len(metadata),
        "crop_modes": "; ".join(f"{key}:{value}" for key, value in sorted(modes.items())),
        "sparse_body_rows": modes.get("sparse_body", 0),
    }


def run_one(
    *,
    repo_root: Path,
    dataset_dir: Path,
    batch_output_dir: Path,
    image: dict,
    args: argparse.Namespace,
) -> dict:
    images_dir = dataset_dir / "images" / "raw"
    image_path = images_dir / str(image["file_name"])
    image_output_dir = output_dir_for_image(batch_output_dir / "runs", image)
    payload_path = image_output_dir / "safe-review-payload.json"
    metadata_path = image_output_dir / "metadata.json"
    stdout_path = image_output_dir / "pipeline.stdout.log"
    stderr_path = image_output_dir / "pipeline.stderr.log"

    if args.resume and not args.force and payload_path.exists():
        payload = safe_read_json(payload_path)
        metadata = safe_read_json(metadata_path)
        payload_summary = summarize_payload(payload)
        metadata_summary = summarize_metadata(metadata)

        return {
            "image_id": image["id"],
            "file_name": image["file_name"],
            "split": image.get("split", ""),
            "status": "skipped_existing",
            "elapsed_seconds": 0.0,
            "output_dir": str(image_output_dir),
            "error": "",
            **payload_summary,
            **metadata_summary,
        }

    image_output_dir.mkdir(parents=True, exist_ok=True)
    pipeline_path = repo_root / "ocr-service" / "prescription_vision_pipeline.py"
    command = [
        sys.executable,
        str(pipeline_path),
        "--image",
        str(image_path),
        "--output",
        str(image_output_dir),
        "--model",
        args.model,
    ]
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    env["MEDITRACK_QWEN_NAME_BATCH_SIZE"] = str(max(1, args.qwen_name_batch_size))
    env["MEDITRACK_QWEN_SINGLE_FALLBACK_LIMIT"] = str(max(0, args.single_fallback_limit))

    started_at = time.perf_counter()
    status = "completed"
    error = ""

    try:
        result = subprocess.run(
            command,
            cwd=str(repo_root),
            env=env,
            text=True,
            capture_output=True,
            timeout=max(1, int(args.timeout_minutes * 60)),
            check=False,
        )
        stdout_path.write_text(result.stdout or "", encoding="utf-8")
        stderr_path.write_text(result.stderr or "", encoding="utf-8")

        if result.returncode != 0:
            status = "failed"
            error = (result.stderr or result.stdout or "")[-1200:].strip()
    except subprocess.TimeoutExpired as timeout:
        status = "timeout"
        error = f"Timed out after {args.timeout_minutes} minute(s)."
        stdout_path.write_text(process_output_text(timeout.stdout), encoding="utf-8")
        stderr_path.write_text(process_output_text(timeout.stderr), encoding="utf-8")

    elapsed_seconds = round(time.perf_counter() - started_at, 2)
    payload = safe_read_json(payload_path)
    metadata = safe_read_json(metadata_path)
    payload_summary = summarize_payload(payload)
    metadata_summary = summarize_metadata(metadata)

    if status == "completed" and payload_summary["row_count"] == 0:
        status = "completed_zero_rows"

    return {
        "image_id": image["id"],
        "file_name": image["file_name"],
        "split": image.get("split", ""),
        "status": status,
        "elapsed_seconds": elapsed_seconds,
        "output_dir": str(image_output_dir),
        "error": error,
        **payload_summary,
        **metadata_summary,
    }


def write_reports(output_dir: Path, rows: list[dict], started_at: str) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    summary_path = output_dir / "summary.json"
    csv_path = output_dir / "summary.csv"
    html_path = output_dir / "review.html"

    payload = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "started_at": started_at,
        "count": len(rows),
        "rows": rows,
    }
    summary_path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    fields = [
        "image_id",
        "file_name",
        "split",
        "status",
        "elapsed_seconds",
        "detector_rows",
        "crop_modes",
        "sparse_body_rows",
        "row_count",
        "readable_count",
        "uncertain_count",
        "medicine_names",
        "output_dir",
        "error",
    ]

    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()

        for row in rows:
            writable = dict(row)
            writable["medicine_names"] = " | ".join(row.get("medicine_names") or [])
            writer.writerow({field: writable.get(field, "") for field in fields})

    table_rows = []

    for row in rows:
        names = ", ".join(row.get("medicine_names") or [])
        status = str(row.get("status") or "")
        weak = status != "completed" or int(row.get("row_count") or 0) <= 1
        css_class = "weak" if weak else ""
        table_rows.append(
            f"<tr class=\"{css_class}\">"
            f"<td>{html.escape(str(row.get('image_id', '')))}</td>"
            f"<td>{html.escape(str(row.get('file_name', '')))}</td>"
            f"<td>{html.escape(status)}</td>"
            f"<td>{html.escape(str(row.get('detector_rows', '')))}</td>"
            f"<td>{html.escape(str(row.get('crop_modes', '')))}</td>"
            f"<td>{html.escape(str(row.get('row_count', '')))}</td>"
            f"<td>{html.escape(names)}</td>"
            f"<td>{html.escape(str(row.get('elapsed_seconds', '')))}</td>"
            f"</tr>"
        )

    html_doc = f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Prescription Vision Batch Review</title>
    <style>
      body {{ font-family: system-ui, sans-serif; margin: 24px; color: #17202a; }}
      table {{ border-collapse: collapse; width: 100%; }}
      th, td {{ border: 1px solid #d8dee8; padding: 8px; vertical-align: top; }}
      th {{ background: #f3f6fa; text-align: left; }}
      tr.weak {{ background: #fff7ed; }}
      code {{ background: #f3f6fa; padding: 2px 4px; border-radius: 4px; }}
    </style>
  </head>
  <body>
    <h1>Prescription Vision Batch Review</h1>
    <p>Rows highlighted in orange are weak cases: failed, timed out, or only one extracted review row.</p>
    <p>JSON: <code>{html.escape(str(summary_path))}</code></p>
    <p>CSV: <code>{html.escape(str(csv_path))}</code></p>
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Image</th>
          <th>Status</th>
          <th>Detector Rows</th>
          <th>Crop Modes</th>
          <th>Extracted Rows</th>
          <th>Medicine Names</th>
          <th>Seconds</th>
        </tr>
      </thead>
      <tbody>
        {''.join(table_rows)}
      </tbody>
    </table>
  </body>
</html>
"""
    html_path.write_text(html_doc, encoding="utf-8")


def main() -> None:
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[2]
    dataset_dir = args.dataset.resolve()
    output_dir = args.output.resolve()
    manifest_path = dataset_dir / "manifest.json"

    if not manifest_path.exists():
        raise FileNotFoundError(f"Missing dataset manifest: {manifest_path}")

    manifest = read_json(manifest_path)
    images = selected_images(manifest, args)

    if not images:
        raise RuntimeError("No images selected.")

    output_dir.mkdir(parents=True, exist_ok=True)
    started_at = datetime.now(timezone.utc).isoformat()
    rows: list[dict] = []

    print(f"Selected images: {len(images)}")
    print(f"Output: {output_dir}")
    print()

    for index, image in enumerate(images, start=1):
        print(
            f"[{index}/{len(images)}] image_id={image['id']} "
            f"{image['file_name']}",
            flush=True,
        )
        row = run_one(
            repo_root=repo_root,
            dataset_dir=dataset_dir,
            batch_output_dir=output_dir,
            image=image,
            args=args,
        )
        rows.append(row)
        write_reports(output_dir, rows, started_at)
        names = ", ".join(row.get("medicine_names") or [])
        print(
            f"  {row['status']} | rows={row['row_count']} | "
            f"detector={row['detector_rows']} | {names}",
            flush=True,
        )

    write_reports(output_dir, rows, started_at)
    print()
    print("Batch vision test complete")
    print("--------------------------")
    print(f"Summary JSON: {output_dir / 'summary.json'}")
    print(f"Summary CSV:  {output_dir / 'summary.csv'}")
    print(f"Review HTML:  {output_dir / 'review.html'}")


if __name__ == "__main__":
    main()
