# OCR capture deployment

MediTrack uses one evidence-only OCR service for medicine strips, printed bills,
and prescriptions. The Node API performs parsing, medicine resolution, review,
authorization, and saving. The OCR service never writes medicine records.

## Safety behavior

| Input | OCR mode | Save behavior |
| --- | --- | --- |
| Strip/package | Printed OCR with package quality gate | User confirms the selected master before save |
| Bill | Printed OCR with bill-line filtering | User reviews the complete candidate batch before save |
| Prescription | OCR evidence plus existing candidate generators | Every candidate starts as review-only; no automatic confirmation |
| Strip verification | OCR identity evidence plus stored reference | Green only for a strong identity match; weak OCR is inconclusive |

Weak, empty, timed-out, or malformed OCR returns `NO_RESULT`. The backend must
not infer a medicine, strength, stock, or schedule from that result.

## Local development

Docker is the reproducible path because PaddlePaddle has native dependencies.

```powershell
cd C:\Users\tharu\meditrack-ai
$env:OCR_SERVICE_TOKEN="local-ocr-token-change-before-production-1234"
docker compose up --build ocr postgres api
```

The API is then available on `http://localhost:3000` and OCR on port `8000`.
Run the frontend separately with `npm --prefix apps/web run dev`.

Verify a test image without printing its recognized medical text:

```powershell
npm run smoke:ocr -- --ocr-url http://localhost:8000 `
  --file "C:\path\to\strip.jpg" --document-type package
```

The command reads `OCR_SERVICE_TOKEN` from the environment. Repeat with
`--document-type bill` and `--document-type prescription` for those inputs.

## Public deployment

1. Deploy `services/preprocess/Dockerfile` as a private or HTTPS container with
   at least 2 GB memory and persistent storage mounted for `/home/meditrack/.paddlex`.
2. Generate a random service token of at least 32 characters. Configure the same
   token on the OCR service and Render API. Never expose it to Vercel.
3. Configure the OCR service:

```text
OCR_REQUIRE_TOKEN=true
OCR_SERVICE_TOKEN=<random secret>
OCR_EAGER_LOAD=true
PADDLE_DEVICE=cpu
PADDLE_DET_MODEL=PP-OCRv6_medium_det
PADDLE_REC_MODEL=PP-OCRv6_medium_rec
```

4. Configure the Render API:

```text
OCR_SERVICE_URL=https://<ocr-service-host>
OCR_SERVICE_TOKEN=<same random secret>
OCR_ALLOW_TESSERACT_FALLBACK=false
PRESCRIPTION_VISION_MODE=sidecar
```

5. Redeploy the API, check `/api/health/ready`, and run `npm run smoke:ocr`
   against the public OCR URL for one strip, one bill, and one prescription.
6. Test upload, confirmation, private image retrieval, and strip verification
   with patient A. Confirm patient B cannot retrieve patient A's image.

Vercel remains a static frontend and requires no OCR secret. A deployment is not
considered OCR-ready until the public smoke checks pass after a cold start.

## Operational limits

- Handwriting recognition is probabilistic; difficult prescriptions can remain
  unresolved and must be manually reviewed.
- Reflective foil requires a sharp, glare-free, tightly framed photo.
- The first container start downloads model files and is slower than warm starts.
- Do not use ephemeral storage for retained medical images in production.
