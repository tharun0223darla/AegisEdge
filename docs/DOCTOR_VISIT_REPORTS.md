# Doctor Visit Reports

Doctor Visit Reports let a patient prepare a bounded, read-only summary for a
clinical appointment and share that exact snapshot through an expiring link.
The feature is a coordination aid; it is not a diagnosis, prescription, or
replacement for the source medical record.

## Data Flow

1. The authenticated patient chooses a date range and report sections.
2. The backend reads only that patient's records and creates a deterministic
   preview. No LLM is used to interpret, diagnose, or fill missing data.
3. On creation, the selected report is stored as an immutable JSON snapshot.
   Later edits to medicines or dose logs do not silently change a report that
   has already been shared.
4. The patient can download a server-generated PDF or create an expiring share
   link after explicit consent.
5. A recipient can view or download only the stored snapshot. The recipient
   cannot edit the patient account or browse any other record.

Available sections are medicines, adherence, allergies, safety findings,
refills, and vitals. Raw prescription, bill, and package images are never
included.

## Privacy And Security

- Owner endpoints require an authenticated patient and scope every query by
  `patientId`.
- Share tokens contain 32 random bytes. Only a SHA-256 hash is stored in the
  database, so a database read does not reveal active links.
- The token is carried in the browser URL fragment (`#token=...`), which is not
  sent in normal HTTP request paths or server access logs. The public page
  removes it from browser history immediately and holds it only in memory.
- Share links expire after at most 30 days and can be revoked immediately.
- Public report responses use `no-store`, `no-referrer`, `nosniff`, and
  `noindex` protections.
- Successful views and downloads are recorded as access events. Public viewer
  IP addresses and user-agent strings are deliberately not retained.
- Reports are immutable and all create, share, and revoke actions use the
  application audit log.
- Archiving is a soft-delete operation: it removes the report from the active
  list, revokes all links atomically, and preserves the snapshot and audit
  history.

## Operational Limits

- Report range: at most 366 days
- Active reports per patient: 100
- Active share links per report: 5
- Vitals retained in a snapshot: 5,000
- Vitals printed in a PDF: 250
- Share creation is rate limited to 8 requests per minute

These limits bound database reads, response sizes, and PDF memory use. The
report list endpoint returns summaries only; a snapshot is fetched only when a
specific report is opened.

## Deployment

Apply the additive migration before deploying the backend:

```powershell
npx prisma migrate deploy
```

Set `FRONTEND_URL` to the exact public HTTPS frontend origin. Share links use
this value, so a stale localhost value will generate unusable links.

Deploy in this order:

1. Back up the production database.
2. Apply `20260810100000_doctor_visit_reports`.
3. Deploy the backend.
4. Deploy the frontend.
5. Complete the smoke checks below.

## Release Smoke Test

1. Sign in as a patient and open **Doctor Reports**.
2. Preview a seven-day report and verify that unselected sections are absent.
3. Create the report and download its PDF.
4. Create a one-day share link after accepting the consent checkbox.
5. Open the link in a private browser and verify view and PDF download.
6. Confirm the access events appear in the owner's report history.
7. Revoke the link and confirm the private browser can no longer open it.
8. Archive a second report and confirm all of its active links stop working.
9. Confirm a second patient cannot fetch the report by its ID.

## Known Limitation

PDF generation currently uses PDFKit's built-in Helvetica font. Latin-script
content is supported, but some non-Latin patient or medicine text may not render
correctly until an approved Unicode font is embedded in the deployment image.
