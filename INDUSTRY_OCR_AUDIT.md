# MediTrack AI — OCR & Prescription Intelligence Production Audit

**Audit date:** 23 June 2026
**Scope:** Backend OCR, image preprocessing, evidence generation, Release 3 candidate generation, candidate clustering, medicine resolution, persistence safety, benchmark validity, and Python OCR sidecar.

## Executive verdict

The project has a strong production-oriented foundation: modular NestJS services, multi-source candidate generation, evidence-aware contracts, a Prisma persistence layer, and automated regression tests. However, the original implementation was **not yet industry- or clinical-production ready**. The strongest published metrics were generated from synthetic matching cases rather than a held-out set of real prescription images, and several code paths could verify candidates without strong current-document evidence or invent medication schedules when OCR data was incomplete.

This hardening package fixes the highest-risk implementation defects and creates a safer baseline. It does **not** claim clinical validation, guaranteed handwritten prescription recognition, or error-free medicine extraction.

## Critical defects found in the original source

1. **Evidence provenance was unstable**
   - Evidence did not consistently have deterministic identifiers.
   - Line numbers could collide across OCR variants.
   - Evidence was deduplicated and capped, potentially deleting useful observations.

2. **LLM generation caused avoidable latency**
   - The model could be called once for every OCR line.
   - Medium and difficult requests could spend most of their time in repeated semantic extraction and verification.

3. **Unsafe resolution paths**
   - User history or correction data could strongly influence verification even when current-document evidence was weak.
   - Missing evidence could pass as valid in some paths.
   - Line-number-only references were accepted.

4. **Invented medication instructions**
   - Recovery paths could create defaults such as `DAILY`, `08:00`, seven days, or quantity seven when OCR did not provide those facts.
   - Such defaults are not acceptable for medication workflows.

5. **Candidate processing ran more than once**
   - Variant quality evaluation performed resolution/AI verification, followed by another final resolution pass.
   - This increased latency and could make results dependent on retry order.

6. **Cross-user/stale cache risk**
   - Image-hash cache entries included interpreted candidate results that may depend on user history and current model/policy versions.

7. **Layout service overstated confidence**
   - The previous service effectively returned the full page while reporting high-confidence layout segmentation.

8. **Python OCR sidecar lacked production safeguards**
   - Missing strict byte/pixel controls, bounded concurrency, execution timeout, and non-blocking execution.
   - Deskew coordinate ordering and rotation handling required correction.

9. **Benchmark limitations**
   - The 800-case suite is a synthetic dictionary/candidate regression test.
   - It does not establish accuracy on real printed or handwritten prescription images.
   - Medicine occurrence recall in the 50-case Release 3 benchmark remains 88%, showing attribute/occurrence extraction is weaker than name recall.

## Hardening changes applied

### 1. Stable, immutable OCR evidence

Added `ocr-evidence.util.ts` and expanded evidence contracts to support:

- deterministic SHA-256 evidence IDs;
- page and source-image dimensions;
- normalized bounding boxes;
- engine and preprocessing variant provenance;
- optional polygons and coordinate-transform metadata.

The OCR orchestrator now preserves all distinct raw engine/variant observations. It no longer imposes the previous 300-item evidence cap.

### 2. Safer image intake and normalization

The layout/input service now:

- validates MIME type and decodability;
- enforces minimum dimensions and a configurable pixel limit;
- applies EXIF-aware rotation;
- flattens transparency against a white background;
- bounds maximum image dimensions;
- returns a realistic full-page fallback confidence rather than claiming completed layout segmentation.

**Remaining limitation:** this is robust full-page normalization, not a trained prescription-region detector.

### 3. OCR orchestration hardening

The OCR orchestrator now:

- assigns stable evidence IDs to all OCR output;
- records normalized bounding boxes and source dimensions;
- has configurable per-variant timeouts;
- explicitly terminates and recreates timed-out Tesseract workers;
- triggers PaddleOCR using stronger quality signals;
- can stop escalation when OCR quality and medication-context evidence are already strong;
- preserves all evidence instead of mutating it into one opaque text result.

### 4. Regex candidate generator rewrite

The Regex generator now uses bounded staged parsing rather than one broad extraction rule. It supports:

- multi-word names;
- tablet/capsule/syrup/injection markers;
- normal and combined strengths;
- quantity, frequency and duration cues;
- deterministic mention IDs;
- exact evidence references.

It no longer invents clock times, duration, quantity, or instructions.

### 5. Dictionary candidate generator hardening

The Dictionary generator now:

- scopes correction and history retrieval to the authenticated user;
- generates one-to-four-token n-grams;
- builds in-memory exact, prefix, alias, and length indexes once per run;
- avoids database access for every n-gram;
- uses length-aware fuzzy matching and a minimum similarity threshold;
- distinguishes raw OCR text from canonical matched medicine names;
- records match source and retrieval method;
- emits deterministic mention IDs;
- does not invent medication schedules.

### 6. LLM extraction batching

The LLM generator no longer calls the model separately for every OCR line. It now:

- ranks and deduplicates candidate-relevant evidence;
- sends bounded chunks of evidence to the model;
- caches duplicate chunks within one extraction run;
- validates and maps model output through the shared candidate contract;
- preserves unsupported mentions as unresolved rather than silently accepting or deleting them.

Regex and Dictionary generators continue to scan the complete evidence set.

### 7. Non-destructive candidate clustering

The clustering service now:

- preserves every original mention;
- clusters across generators and compatible OCR variants;
- requires compatible location/evidence support;
- avoids merging unresolved mentions merely because names look similar;
- handles normalized bounding-box overlap;
- preserves conflicting strengths and schedules;
- uses deterministic cluster IDs instead of random UUIDs.

### 8. Evidence-first resolution safety

Medicine resolution now:

- treats missing evidence as invalid;
- requires exact stable evidence identifiers;
- verifies document/run provenance, page, engine, variant, and text overlap;
- does not count partial or invented references as valid support;
- prevents user history alone from auto-verifying a current prescription candidate;
- allows model verification only after current-document evidence is validated;
- clears timeout resources correctly.

### 9. Removed fabricated medication schedules

Fallback and recovery paths no longer manufacture:

- `DAILY` frequency;
- `08:00` reminder time;
- seven-day duration;
- quantity seven;
- generic directions not present in evidence.

Unknown attributes remain unknown and must be confirmed by a user or clinician before schedule creation.

### 10. Removed duplicate resolution work

Variant scoring now evaluates generated evidence/clusters without running the complete verification pipeline. Final AI verification and resolution run only once after cross-variant aggregation.

### 11. Safer OCR cache

The file cache now:

- reuses raw OCR/evidence only, not user-specific final candidate decisions;
- includes a cache-version salt;
- has configurable TTL and maximum entries;
- uses atomic file replacement;
- applies restrictive file permissions where supported;
- logs only a short hash prefix.

**Remaining limitation:** a synchronous local JSON cache is not suitable for multi-instance healthcare deployment. Use encrypted Redis/object storage or a database-backed cache with an explicit retention policy.

### 12. User-scoped correction uniqueness

`MedicineCorrection` is no longer globally unique by raw text. A migration creates a user-scoped uniqueness constraint:

```text
(userId, rawExtractedName)
```

### 13. Python PaddleOCR sidecar safeguards

The sidecar now includes:

- request byte and decoded-pixel limits;
- minimum image-size validation;
- bounded concurrency;
- request timeout;
- blocking OCR execution moved to worker threads;
- sanitized errors;
- corrected deskew coordinate order and rotation limits.

## Verification completed in this environment

### Standard Jest suite

```text
Test Suites: 4 passed, 4 total
Tests:       30 passed, 30 total
Failures:    0
Snapshots:   0
```

Two error-level log entries are deliberately generated by tests that validate model timeout/failure handling; the tests pass.

### Release 3 50-case regression benchmark

```text
LLM-only medicine-name recall:       100.00%
Regex-only medicine-name recall:      98.00%
Dictionary-only medicine-name recall: 94.00%
Union medicine-name recall:          100.00%
Medication-occurrence recall:         88.00%
Evidence-reference accuracy:         100.00%
Unsupported mention rate:              1.10%
P50 candidate check latency:          ~1.05 ms
P95 candidate check latency:          ~3.70 ms
```

These are **candidate-generation regression metrics**, not full OCR or end-to-end clinical metrics.

### Python validation

Both sidecar files pass Python syntax compilation:

```text
services/preprocess/main.py
services/preprocess/preprocessing.py
```

### Build limitation in this environment

A full production TypeScript build could not be independently certified here because Prisma engine generation attempted to reach `binaries.prisma.sh`, which was unavailable in this sandbox. A temporary local type stub was used only to execute focused tests and is not included in the deliverable.

Run `npx prisma generate` and `npm run build` on the development machine before merging.

### 800-case suite limitation

The 800-case evaluation is synthetic and was not completed within the execution limit in this environment after stricter production validation was enabled. It must be run locally as a slow regression suite. It must not be represented as proof of handwritten prescription OCR accuracy.

### Dependency audit

The current dependency graph reports:

```text
Critical: 0
High:     7
Moderate: 2
Total:    9
```

Affected packages include NestJS dependency paths, Multer, form-data, js-yaml, and qs. Apply controlled dependency upgrades and regression testing; do not run a destructive forced audit fix without review.

## Remaining requirements before industry deployment

### P0 — Mandatory

1. **Real held-out prescription image dataset**
   - de-identified printed prescriptions;
   - handwritten prescriptions;
   - multiple hospitals/doctors/cameras;
   - blur, perspective, shadows, compression and mixed scripts;
   - occurrence-level ground truth for name, strength, form, frequency, duration, and evidence location.

2. **Mandatory human confirmation**
   - no uncertain extraction may create an active medication or reminder;
   - the UI must show source crop, extracted value, confidence, conflicts, and editable fields;
   - every confirmation/correction requires an audit event.

3. **Asynchronous job architecture**
   - queue OCR/LLM jobs;
   - enforce idempotency;
   - support cancellation, retry policy, dead-letter handling and progress reporting;
   - isolate OCR workers from the API process.

4. **Protected-health-information controls**
   - encryption at rest and in transit;
   - explicit document deletion/retention policy;
   - redacted logs and traces;
   - access auditing;
   - signed storage URLs;
   - secrets manager instead of local `.env` in deployment.

5. **True layout/region detection**
   - retain original page and transform chain;
   - detect prescription body, patient metadata, doctor instructions and tables;
   - benchmark region recall independently.

6. **Safety and security validation**
   - upload fuzzing and decompression-bomb tests;
   - prompt-injection tests against OCR text;
   - authorization and cross-user tests;
   - load, soak, chaos and recovery tests;
   - backup/restore exercises.

### P1 — Strongly recommended

- Decompose the very large `prescriptions.service.ts` into orchestration, persistence, confirmation, variant selection and response-mapping services.
- Replace local JSON cache/log files with a protected shared store and OpenTelemetry-based observability.
- Calibrate confidence separately by OCR engine, document type and preprocessing variant.
- Pre-build model weights/language data into immutable worker images.
- Version and govern MedicineMaster, aliases, correction policies and model prompts.
- Raise medication-occurrence recall above the current 88% before automating schedules.
- Resolve production dependency vulnerabilities.
- Add field-level metrics for strength, frequency, duration and dosage-form accuracy.

## Required local validation commands

From the project root:

```powershell
npm ci
npx prisma generate
npx prisma migrate dev --name scope_medicine_corrections_by_user
npm run build
npm run lint
npm test -- --runInBand --detectOpenHandles
npm run test:e2e
npm run test:slow
npm run benchmark:recall
python -m py_compile services/preprocess/main.py services/preprocess/preprocessing.py
docker compose up --build
```

For deployment environments use:

```powershell
npx prisma migrate deploy
```

Review migration output and back up the database before applying schema changes.

## Final status

```text
OCR/candidate architecture:       Substantially hardened
Evidence traceability:            Stronger and deterministic
Candidate recall architecture:    Strong
Unsafe schedule fabrication:      Removed
Duplicate AI resolution:          Removed
Standard tests:                   Passed (30/30)
50-case candidate benchmark:      Passed, occurrence recall 88%
Full local build:                 Must be rerun with generated Prisma client
800-case synthetic benchmark:     Must be rerun locally
Real handwritten-image validation:Not yet completed
Clinical production readiness:    Not approved
```

This package is a safer **production-oriented engineering baseline**, not a clinically validated medication extraction system.
