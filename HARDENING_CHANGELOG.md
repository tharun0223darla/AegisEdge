# OCR Hardening Changelog

## Added

- `src/prescriptions/ocr-evidence.util.ts`
- deterministic evidence and candidate identifiers;
- normalized bounding-box and provenance metadata;
- run-scoped chunk caching for local LLM candidate extraction;
- configurable OCR, candidate-generation and pipeline limits;
- user-scoped MedicineCorrection migration;
- benchmark failure/integrity reports;
- production audit documentation.

## Changed

- OCR evidence is preserved without the previous 300-item cap.
- Tesseract variant timeouts terminate/recreate workers.
- PaddleOCR fallback uses OCR-quality and medication-context signals.
- Regex extraction uses staged parsing and no longer invents schedules.
- Dictionary matching uses indexed n-grams, scoped history/corrections and safer fuzzy rules.
- LLM extraction runs on bounded evidence chunks instead of one call per line.
- Candidate clustering is deterministic and non-destructive.
- Resolution requires current-document evidence before machine verification.
- Image cache stores OCR/evidence only, not user-specific resolved candidates.
- Variant quality evaluation no longer performs duplicate AI verification.
- Recovery paths preserve unknown medication attributes instead of filling defaults.
- Python preprocessing service enforces size, pixel, concurrency and timeout limits.

## Database

- `MedicineCorrection.rawExtractedName` global uniqueness removed.
- Added `@@unique([userId, rawExtractedName])` and corresponding migration.

## Verification

- Standard Jest suite: 30/30 passed.
- 50-case Release 3 candidate regression benchmark regenerated.
- Python sidecar syntax compilation passed.
- Full build and slow 800-case suite require rerun in a network-enabled local environment.
