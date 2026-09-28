# MediTrack PP-OCRv6 service

This service extracts OCR evidence for package strips, printed bills, and
prescriptions. It returns text, line geometry, confidence, the selected image
variant, and a quality decision. It does not identify or save a medicine.

## Safety contract

- Camera EXIF orientation is applied before preprocessing.
- Image size, pixel count, concurrency, and processing time are bounded.
- Original, contrast, illumination-normalized, and adaptive-threshold variants
  are available. Printed documents stop early once the quality gate accepts
  trustworthy evidence, keeping CPU latency bounded.
- Printed images use a CPU-safe resolution bound. Bill PDFs are rendered
  page-by-page and reject files over the configured page/pixel limits.
- Weak output returns `success: false`, `source: NO_RESULT`, and no text/lines.
- Logs contain counts, confidence, timing, and failure reasons, never OCR text.
- API calls can be authenticated with `X-OCR-Service-Token`.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health/live` | Process liveness |
| `GET` | `/health/ready` | Loads/checks the OCR models |
| `POST` | `/preprocess` | Diagnostic preprocessed PNG |
| `POST` | `/ocr` | Structured OCR evidence |

`POST /ocr` accepts multipart fields `file` and `documentType`. Supported
document types are `package`, `bill`, `prescription`, and `generic`.
PDF input is accepted only for `bill` and is limited by `OCR_MAX_PDF_PAGES`
(default `4`, hard maximum `8`).

## Local Docker run

From the repository root:

```powershell
$env:OCR_SERVICE_TOKEN="use-a-long-random-local-token"
docker compose up --build ocr api
```

The first readiness check downloads the official PaddleOCR models into the
`meditrack-ocr-models` volume. Later starts reuse that cache.

For a sidecar-only check:

```powershell
docker build -t meditrack-ocr .\services\preprocess
docker run --rm -p 8000:8000 `
  -e OCR_SERVICE_TOKEN="use-a-long-random-local-token" `
  -e OCR_REQUIRE_TOKEN=true `
  meditrack-ocr
```

## Public deployment

Deploy this directory as a separate Docker service. Configure the API with:

```text
OCR_SERVICE_URL=https://your-private-or-https-ocr-service
OCR_SERVICE_TOKEN=<same strong token on both services>
OCR_ALLOW_TESSERACT_FALLBACK=false
PRESCRIPTION_VISION_MODE=sidecar
OCR_MAX_VARIANTS=4
OCR_VARIANT_BUDGET_SECONDS=90
```

The OCR container needs persistent model cache storage and materially more
memory than the Node API. A 512 MB free web instance is not a reliable target
for PP-OCRv6 Medium; choose a container/VM with at least 2 GB RAM, or configure
the official mobile detection/recognition model names after measuring recall.
Vercel hosts only the frontend and must never receive the OCR service token.

## Important limitation

OCR improves evidence extraction but cannot guarantee correct handwriting.
Every strip, bill line, and prescription candidate remains subject to the
existing user confirmation/review flow.
