# Production Release Guide

For the full staging-to-production rollout process, release sign-off, rollback, and monitoring checklist, see [PRODUCTION_ROLLOUT.md](PRODUCTION_ROLLOUT.md).

For a student-friendly free/near-free demo deployment path, see [STUDENT_FREE_DEPLOYMENT.md](STUDENT_FREE_DEPLOYMENT.md).

## Release gates

Run the credential-free gate during development and CI:

```powershell
npm run verify:ci
```

Run the strict release gate with production values loaded from a protected file:

```powershell
npm run verify:release -- --env-file=.env.production
```

The strict gate rejects HTTP public URLs, localhost/LAN API addresses, weak or reused JWT secrets, missing Android signing values, invalid Prisma schema, failed tests, and failed backend/web/Android builds.

## Required production inputs

- HTTPS API origin, for example `https://api.example.com`
- HTTPS frontend origin, for example `https://app.example.com`
- Managed PostgreSQL connection string
- Distinct random JWT access and refresh secrets
- JDK 21 for Android builds (set `JAVA_HOME` explicitly)
- Android upload/release keystore and four signing environment values
- Monotonic `ANDROID_VERSION_CODE`, semantic `ANDROID_VERSION_NAME`, and the exact release `GIT_COMMIT_SHA`
- Private object storage for prescriptions, bills, and package images
- `MEDICAL_FILE_STORAGE` explicitly set to `private-object`, `persistent-local`, or `demo-ephemeral-local`
- Provider credentials only for enabled external integrations

Start from `.env.production.example`. Store real values in the hosting provider secret manager and GitHub Actions secrets, never in Git.

## Deployment sequence

1. Run `npm ci` in the repository root and `apps/web`.
2. Run `npx prisma generate`.
3. Back up the production database.
4. Run `npx prisma migrate deploy` against staging, then production.
5. Run `npm run verify:release -- --env-file=.env.production`.
6. Deploy the backend and confirm `/health/ready` succeeds.
7. Deploy the web build and run login, search, schedule, and admin smoke tests.
8. Publish the signed Android AAB/APK only after staging reminder tests pass.

## Android API configuration

1. Copy `apps/web/.env.android.example` to the ignored `apps/web/.env.android` file.
2. Set `VITE_API_URL` to the deployed HTTPS API URL including `/api`.
3. Add `https://localhost` to the backend `FRONTEND_URL` origin list for the Capacitor WebView. Keep the deployed Vercel origin in the same comma-separated value.
4. Run `npm run cap:sync` from `apps/web` before Gradle assembles the APK.

The Android build and Gradle `preBuild` task verify the API URL in both the Vite output and the actual Capacitor assets. They reject HTTP, localhost, emulator-only, and private-LAN API endpoints.

For every signed release, set immutable build identity before running Gradle:

```powershell
$env:ANDROID_VERSION_CODE="2"
$env:ANDROID_VERSION_NAME="1.0.1"
$env:GIT_COMMIT_SHA=(git rev-parse HEAD)
```

`ANDROID_VERSION_CODE` must increase for every published build. The app exposes its version, build number, commit SHA, and dirty-worktree status in Health Connect diagnostics so an installed APK can be tied back to source. Release builds fail when signing or build identity is missing.

## Reminder regression matrix

Verify an existing and newly-created medicine in each state:

- App open
- App backgrounded
- App force-closed
- Device offline after synchronization
- Device restarted
- Timezone changed
- Another schedule added shortly before the first reminder fires

A release is blocked if any previously passing reminder scenario fails.
