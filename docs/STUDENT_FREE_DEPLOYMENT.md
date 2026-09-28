# Student Free Deployment Guide

This guide is the safe, low-cost path for a student demo or portfolio deployment. It is not a public healthcare production launch. Free tiers are useful for review, testing, and demonstrations, but they usually do not include healthcare compliance, guaranteed uptime, full backups, or enough storage for every feature.

## Recommended Free Stack

Use this stack first:

- Web app: Vercel Hobby
- Backend API: Render Free Web Service
- PostgreSQL: Supabase Free Postgres
- Medical files: Supabase Storage private bucket, or disable upload-heavy demos until object storage is wired
- Android: local debug APK for testing; signed release later

Avoid Railway for a strict zero-cost setup because its current free trial is credit/time limited, then it requires a paid plan.

## What This Deployment Is Good For

- Showing login, medicine search, medicine details, schedules, reminders, admin review, and safe incomplete-detail UI.
- Sharing an HTTPS web link for review.
- Testing the Android app against a public HTTPS API.
- Proving the release pipeline and CI gates.

## What This Deployment Is Not Good For

- Real patient use.
- Storing sensitive real prescriptions or bills.
- Guaranteed reminder delivery at all times.
- Heavy OCR/VLM processing.
- Full 340k medicine dataset plus large clinical text if the database exceeds the free DB limit.

## Free-Tier Landmines

- Supabase Free has limited database and file storage. Large medicine imports, indexes, and clinical text can exceed the limit.
- Supabase Free projects can pause after inactivity.
- Render Free services can sleep and cold-start slowly.
- Render Free does not give you a durable upload disk by default.
- Vercel environment variables prefixed with `VITE_` are exposed to the browser. Never put secrets there.
- Free hosting is fine for demo data, not for private patient records.

## Safe Demo Data Strategy

For the first deployed demo, do not import every row if the free database is tight. Use one of these:

- A small seed: common Indian medicines plus salts already enriched.
- A medium seed: top searched medicines, top chronic medicines, and common antibiotics.
- Full identity database only after checking database size and indexes.

Clinical details must still obey the source-backed rule: no field appears unless it has a trusted source reference.

## Environment Values

Backend production values:

```env
NODE_ENV=production
DATABASE_URL=postgresql://...
JWT_SECRET=generate-a-long-random-secret
JWT_REFRESH_SECRET=generate-a-different-long-random-secret
API_BASE_URL=https://your-render-api.onrender.com
FRONTEND_URL=https://your-vercel-app.vercel.app
MEDICAL_FILE_STORAGE=private-object
MEDICAL_FILE_STORAGE_BUCKET=meditrack-medical-files
OPENFDA_API_KEY=optional-but-recommended
TAVILY_API_KEY=admin-only-web-source-assist-key
PHONE_NOTIFICATIONS_ENABLED=false
```

Frontend production values:

```env
VITE_API_URL=https://your-render-api.onrender.com/api
VITE_ENABLE_DEVTOOLS=false
```

Android values:

```env
VITE_API_URL=https://your-render-api.onrender.com/api
```

## Medical File Storage Modes

The release gate requires `MEDICAL_FILE_STORAGE` so the storage risk is explicit:

- `private-object`: production target. Use a private object-storage bucket and serve files only through authenticated API endpoints.
- `persistent-local`: acceptable only for a controlled single-server deployment with an encrypted persistent disk.
- `demo-ephemeral-local`: demo only. Requires `ALLOW_DEMO_EPHEMERAL_MEDICAL_UPLOADS=true`; uploaded medical files may disappear after restart or redeploy.

For a student demo, the safest path is to keep real medical uploads disabled or use fake/demo images until private object storage is fully wired.

## Deployment Order

1. Confirm GitHub Actions is green on `main`.
2. Create a Supabase project and copy the pooled PostgreSQL connection string.
3. Create a Render web service for the backend.
4. Add backend env values in Render.
5. Run Prisma migrations against Supabase:

   ```powershell
   npx prisma migrate deploy
   ```

6. Deploy backend and confirm:

   ```text
   https://your-render-api.onrender.com/health/ready
   ```

7. Create a Vercel project for `apps/web`.
8. Set `VITE_API_URL=https://your-render-api.onrender.com/api`.
9. Deploy web.
10. Run smoke tests with demo accounts.

## Smoke Tests

Run these before sharing the demo link:

- Register and login.
- Search `Dolo 650`, `Augmentin 625`, and one rare medicine.
- Add a medicine manually.
- Create a schedule for a newly-added medicine.
- Confirm incomplete clinical details show the safe pending UI.
- Confirm admin pages reject a patient user.
- Confirm `/health/ready` returns healthy.

## Stop Rules

Do not share the demo link if:

- CI is red.
- `/health/ready` is failing.
- Login fails.
- Patient users can open admin screens.
- Medical uploads are public.
- Real patient data was imported into a free demo environment.

## Next Engineering Step

Before using real prescriptions, bills, or package photos in deployment, implement private object storage for medical files. The authenticated file endpoints are already the correct boundary; the remaining work is to store the bytes in a private bucket instead of local disk.
