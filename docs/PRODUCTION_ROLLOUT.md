# MediTrack Production Rollout Runbook

This runbook is the deployment path for a production-grade MediTrack release. It assumes the release gate is already green locally and in GitHub Actions.

## Deployment Principles

- Ship from `main` only after CI is green.
- Use three environments: local, staging, production.
- Deploy to staging first, run smoke tests, then promote the same commit to production.
- Keep real secrets only in the hosting provider secret manager and GitHub Actions secrets.
- Run database migrations explicitly before application traffic is moved.
- Do not expose medical uploads publicly unless access control is enforced.
- Keep rollback simple: previous app image plus database backup/restore plan.

## Target Architecture

### Frontend

- Host the web app on a static HTTPS host/CDN.
- Build command: `cd apps/web && npm ci && npm run build`.
- Output directory: `apps/web/dist`.
- Required build variable: `VITE_API_URL=https://api.your-domain.com/api`.

### Backend API

- Run the NestJS API as a container or Node service.
- Required runtime command after build: `npm run start:prod`.
- Health checks:
  - Liveness: `/health/live`
  - Readiness: `/health/ready`
- Public API URL must be HTTPS.

### Database

- Use managed PostgreSQL, not a local Docker volume.
- Enable automated daily backups before first production migration.
- Run `npx prisma migrate deploy` for staging and production.
- Never run `prisma db push` against production.

### Medical File Storage

The current code stores uploads on disk under `uploads/`. This is acceptable for local testing and a single staging instance with a persistent volume, but production should move medical files to private object storage.

Production rule:

- Prescriptions, bills, and package photos must be owner/admin-only.
- Object storage should be private by default.
- Access should go through authenticated API endpoints or short-lived signed URLs.

Until object storage is implemented, production must use a persistent encrypted volume and must not run multiple API replicas that write to separate local disks.

## Environment Setup

Create one protected env file per environment:

- `.env.staging`
- `.env.production`

Start from `.env.production.example` and fill:

- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `API_BASE_URL`
- `FRONTEND_URL`
- `VITE_API_URL`
- `OPENFDA_API_KEY`
- `TAVILY_API_KEY`
- `EMAIL_VERIFICATION_ENABLED=true`
- `EMAIL_VERIFICATION_PROVIDER=brevo` with `BREVO_API_KEY`, or
  `EMAIL_VERIFICATION_PROVIDER=smtp` with `SMTP_HOST`, `SMTP_PORT`,
  `SMTP_SECURE`, `SMTP_USER`, and `SMTP_PASSWORD`
- `EMAIL_FROM_ADDRESS` set to the authenticated mailbox or an authorized alias
- `EMAIL_FROM_NAME`
- `EMAIL_NOTIFICATIONS_ENABLED=true` only after the notification migration is applied and a test email succeeds

Medication emails are explicit opt-in per account. The master switch is fail-closed,
and medicine names remain excluded until the user separately enables them in
Settings. Brevo acceptance is tracked in `notification_deliveries`; temporary
provider failures are retried with bounded backoff.

Before deploying, validate the selected provider. For personal Gmail, use
`smtp.gmail.com`, port `465`, `SMTP_SECURE=true`, and a Google App Password.
Never use or store the normal Google account password.

```powershell
npm run email:check -- --env-file=.env.production.local
```

The default check authenticates without sending or printing credentials. Test
real inbox delivery before release with:

```powershell
npm run email:check -- --env-file=.env.production.local --send-to=your-test-address@example.com
```

Personal SMTP is suitable for a small pilot, but provider quotas, anti-spam
controls, and weaker delivery telemetry make it unsuitable for large-scale
transactional mail. Move back to Brevo or another transactional provider as
volume grows.

The production email slice remains unapproved until the delayed real-world
acceptance runbook in `docs/EMAIL_NOTIFICATION_ACCEPTANCE.md` is completed.

- phone notification provider settings, only if enabled
- Android signing values, only in release build environments
- `ANDROID_VERSION_CODE` increased from the previous published build
- `ANDROID_VERSION_NAME` set to the release version
- `GIT_COMMIT_SHA` set to the exact clean release commit

Secrets must be unique per environment. Staging secrets and production secrets must never be reused.

## Release Flow

1. Confirm GitHub Actions is green on `main`.
2. Create a staging database backup if staging already has data.
3. Deploy migrations to staging:

   ```powershell
   npx prisma migrate deploy
   ```

4. Deploy the backend to staging.
5. Deploy the frontend to staging.
6. Run staging smoke tests.
7. Run the strict release gate with production-shaped secrets:

   ```powershell
   npm run verify:release -- --env-file=.env.production
   ```

8. Back up the production database.
9. Deploy migrations to production.
10. Deploy backend production.
11. Deploy frontend production.
12. Run production smoke tests.
13. Record the released commit SHA, migration version, and smoke-test result.

## Staging Smoke Tests

Run these before every production release:

- A new patient can register with any valid email, receives one verification
  link, and cannot sign in before using it.
- The verification link is single-use and an expired link can be replaced
  through the non-enumerating resend flow.
- An existing pre-migration account can still sign in.
- A Care Circle invitation can be sent to an unregistered caregiver email; the
  recipient registers, verifies that same address, signs in, and explicitly
  accepts the invitation.
- Medicine master search returns known medicines.
- Manual medicine add works.
- Medicine details show source-backed clinical information when available.
- Incomplete details show the production-safe pending UI.
- Admin clinical review page is accessible only to admin.
- Schedule creation works for a newly-added medicine.
- Local notification permission request works on Android.
- Reminder fires for an existing medicine and a newly-created medicine.
- Bill/package/prescription uploads either work or fail with clear safe errors.
- A patient can create a Doctor Visit Report, download its PDF, and share it
  through an expiring consent-gated link.
- A revoked Doctor Visit Report link stops working immediately, while prior
  successful views remain visible in the owner's access history.
- `/health/ready` returns healthy.

## Production Smoke Tests

Run immediately after production deploy:

```powershell
npm run smoke:production -- --api-url https://api.your-domain.com --web-url https://app.your-domain.com
```

This automated check is read-only. It verifies the frontend application shell,
API liveness, database readiness, the anonymous authentication boundary, and
the configured frontend-to-API CORS policy. The default 120-second timeout
allows a free-tier backend to wake from a cold start.

Run the authenticated, non-destructive boundary check with a dedicated,
verified patient account. Copy `.env.smoke.example` to `.env.smoke.local`, fill
only synthetic test-account credentials, and keep that file out of Git:

```powershell
npm run smoke:production:auth
```

This signs in once and verifies current-user identity, medicine listing and
master search, medication-safety and doctor-report schema access, and that a
patient receives `403` from an admin-only endpoint. It does not create or
delete medical records. Login updates the synthetic account's last-login time
and normal authentication audit log, as expected.

- `/health/live`
- `/health/ready`
- Login with a test account.
- Search `Dolo 650`, `Augmentin 625`, and one rare medicine.
- Add medicine manually and create a reminder.
- Confirm admin-only pages are blocked for a patient account.
- Confirm upload size limits and file-type validation.
- Create, view, download, and revoke one expiring Doctor Visit Report link.

## Rollback Plan

Application rollback:

- Re-deploy the previous known-good backend image or commit.
- Re-deploy the previous frontend build.
- Confirm `/health/ready`.

Database rollback:

- Prefer forward-fix migrations when possible.
- If data corruption occurs, restore from the latest pre-release backup.
- Record the restore point, affected users, and corrective action.

## Monitoring Checklist

Minimum production monitoring:

- API uptime for `/health/ready`.
- 5xx error rate.
- Login error rate.
- Database CPU, storage, and connection count.
- Upload failure rate.
- Notification delivery failures.
- Background enrichment failures.
- Disk usage if using local upload volume.

Alert immediately on:

- `/health/ready` failing for 3 consecutive checks.
- Database connection failures.
- Upload storage above 80%.
- Notification scheduler failures.
- Sudden increase in 401/403 or 5xx errors.

## Release Sign-Off

Every production release should record:

- Commit SHA
- GitHub Actions run URL
- Migration status
- Staging smoke test result
- Production smoke test result
- Rollback owner
- Known limitations

## Current Production Blockers

These are not blockers for staging, but they should be resolved before a public production launch:

- Replace disk-backed medical uploads with private object storage or deploy with a persistent encrypted volume and one API replica.
- Configure real phone notification provider credentials if SMS/WhatsApp is enabled.
- Configure production Android signing and produce a signed release artifact.
- Decide production hosting provider and domain names.
- Configure HTTPS certificates and DNS.
