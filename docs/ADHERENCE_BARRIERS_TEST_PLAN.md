# Adherence Barriers Release Test Plan

## Automated gates

- [x] Prisma schema formats and validates.
- [x] Additive migration applies to the local database.
- [x] Existing dose-action idempotency tests pass.
- [x] A patient can record a structured reason for their own missed dose.
- [x] Another patient's dose is returned as not found and is not modified.
- [x] Pending and taken doses reject barrier reasons.
- [x] Thirty-day aggregation counts recorded and unrecorded reasons.
- [x] Side-effect guidance forbids unsupervised treatment changes.
- [x] Backend lint ratchet, tests, and production build pass.
- [x] Frontend lint ratchet, typecheck, and production build pass.
- [x] Android web build, Capacitor sync, lint, unit tests, and debug APK pass.
- [x] Authenticated production smoke script validates the read-only summary schema.

## Local acceptance tests

- [ ] Mark a due dose as skipped and confirm `Add reason` appears.
- [ ] Save `Forgot`, refresh, and confirm the reason remains selected.
- [ ] Change the same dose to `Routine changed` and confirm only the latest reason is shown.
- [ ] Let a test dose become missed, then record `Ran out` from Dose Logs.
- [ ] Confirm the 30-day panel updates its counts without a full page reload.
- [ ] Select `Side-effect concern` and verify the clinician/pharmacist warning appears before save.
- [ ] Confirm taken, pending, and snoozed doses do not offer reason capture.
- [ ] Export CSV and confirm the structured barrier label is included.
- [ ] Check the modal at 360 px width and with the Android keyboard open.

## Production acceptance tests

- [x] Confirm Render applies `20260814210000_adherence_barriers` successfully.
- [x] Confirm GitHub Actions, Render, and Vercel are green for the same commit.
- [x] Run `npm run smoke:production`.
- [x] Run `npm run smoke:production:auth` and confirm the barrier-summary check passes.
- [ ] Record one disposable test reason in production and verify it survives refresh and sign-out/sign-in.
- [ ] Confirm a different patient account cannot read or change that dose-log reason.

## Safety boundaries

- [ ] No view recommends a replacement dose, double dose, or treatment change.
- [ ] No barrier reason is exposed to caregivers without a separately reviewed consent design.
- [ ] No free-text reason is stored in this release.
- [ ] Emergency wording is visible for severe symptoms and does not claim emergency monitoring.
