# Prescription Medicine-Name Detection Dataset

This folder prepares the full-prescription images for training a detector that finds medicine-name regions before OCR reads the cropped words.

The copied prescription images may contain private medical information. Keep `images/` and `exports/` local and do not commit or upload them without redaction and consent.

## Layout

- `images/raw/` - local extracted prescription images from `archive.zip`.
- `manifest.json` - image dimensions, source entry, split, and hash.
- `annotations/medicine_boxes.coco.json` - reviewed medicine-name boxes in COCO format.
- `splits/*.txt` - train/val/test image lists.
- `exports/` - generated training exports, ignored by git.

## Annotate

Run the local annotation server:

```powershell
node tools/prescription-annotation/server.mjs
```

Open `http://127.0.0.1:4677`, draw one box around each medicine name, and click `Save reviewed` for every image. The tool writes directly to `annotations/medicine_boxes.coco.json`.

If geometry prelabels exist, the tool can show them as starting boxes when `Show prelabels` is enabled. They are noisy suggestions; they become training labels only after you review and save the image.

Create rough geometry prelabels:

```powershell
python tools/prescription-annotation/auto_prelabel_geometry.py
```

## Validate

```powershell
node tools/prescription-annotation/validate_detection_dataset.mjs
```

## Export YOLO

Use the `Export YOLO` button in the annotator. It creates:

```text
exports/yolo_medicine_name/
  data.yaml
  train.txt
  val.txt
  test.txt
  labels/
```

The YOLO label class is:

```text
0 medicine_name
```
