# Patient Companion AI

## Purpose

MediTrack uses a provider-independent AI adapter for a bounded wellness companion.
It is not a diagnostic system and must not prescribe, change medication, or replace
professional care.

## Provider architecture

`CoreAIService` exposes the existing `generate` and `generateJSON` contracts while
selecting an available provider in this order by default:

1. Groq (`GROQ_API_KEY`)
2. Local Ollama (`OLLAMA_URL`)

The order can be changed with `AI_PROVIDER_ORDER`. Groq is hosted, so no model is
downloaded to the API server or patient device. Provider failures use a bounded
timeout and circuit cooldown before the adapter tries the next configured provider.

Required production settings:

```env
GROQ_API_KEY=<secret stored in the hosting platform>
GROQ_MODEL=qwen/qwen3-32b
GROQ_BASE_URL=https://api.groq.com/openai/v1
AI_PROVIDER_ORDER=groq,ollama
AI_REQUEST_TIMEOUT_MS=15000
```

Never expose `GROQ_API_KEY` through a `VITE_` variable or commit it to Git. Only the
backend calls Groq.

## Safety boundary

`PatientCompanionSafetyService` runs before and after model generation:

- Urgent phrases receive a deterministic escalation response without calling AI.
- Requests to start, stop, or change a medicine or dose are blocked.
- Responses claiming a diagnosis, cure, or medication change are rejected.
- Missing or failed providers return a fixed safe fallback.
- Stored summaries are labelled `USER_REPORTED` and `isDiagnosis: false`.

Only bounded recent conversation text is sent to Groq. Patient names, medicine
lists, vitals, and profile records are not added to the model prompt.

## Runtime checks

The public liveness endpoint is deliberately outside the global API prefix:

```text
GET /health/live
```

Authenticated users can inspect the configured companion provider through:

```text
GET /api/ai-voice/status
```

The Settings page displays this result as `CONFIGURED` or `UNAVAILABLE`. It never
receives or displays the provider key.

## Verification

Before release, run:

```powershell
npm test -- --runInBand src/ai/core-ai.service.spec.ts src/ai-voice/patient-companion-safety.service.spec.ts src/common/config/env.validation.spec.ts
npm run build
npm run lint:ratchet
npm --prefix apps/web run typecheck
npm --prefix apps/web run build
npm --prefix apps/web run lint:ratchet
```

After adding the same environment variables to the production backend, redeploy the
backend and verify `/health/live`. Sign in to the application, open Settings, and
confirm that Patient Companion AI reports Groq as configured before enabling it for
users.
