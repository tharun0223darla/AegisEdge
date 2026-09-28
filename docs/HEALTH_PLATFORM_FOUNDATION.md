# Health Platform Foundation

## Purpose

This slice establishes the trusted observation boundary used by future Health Connect, BLE,
vendor-device, trend-analysis, and patient-assistant features. It is a wellness-support system,
not a diagnostic engine.

## Data Flow

1. A manual or device adapter submits a metric-specific payload.
2. The server validates allowed fields, ranges, timestamp, and unit.
3. Values are normalized to a canonical unit.
4. The server assigns source, quality, and device provenance.
5. A versioned safety rule produces an auditable assessment.
6. The normalized observation and assessment are stored together.
7. A privacy-safe notification is sent when required and not in cooldown.

No AI model participates in ingestion, unit conversion, provenance, or safety severity.

## Canonical Metrics

| Metric | Canonical value | Canonical unit |
| --- | --- | --- |
| Blood pressure | `systolic`, `diastolic`, optional `pulse` | `mmHg` |
| Blood glucose | `glucose`, `mealStatus` | `mg/dL` |
| Heart rate | `heartRate`, `context` | `bpm` |
| Oxygen saturation | `oxygenSaturation`, optional `pulse` | `%` |
| Sleep | `sleepHours` | `h` |

Glucose in `mmol/L` is accepted and normalized to `mg/dL`. Unknown nested fields are rejected.

## Provenance Rules

- The public health-metric endpoint always writes `MANUAL`, even if an old client sends `source`.
- A self-registered browser device is `UNVERIFIED` and its observations are `QUESTIONABLE`.
- Simulator IDs beginning with `sim-` are `SIMULATOR` and cannot trigger clinical alerts.
- Only an internal native/vendor attestation path may set a device to `VERIFIED`.
- Health Connect will use a dedicated internal ingestion adapter and `HEALTH_CONNECT` source.

This prevents a client from labelling arbitrary JSON as a trusted medical-device reading.

## Replay Protection

Adapters should send a stable `clientRecordId`. The server hashes source, device, metric type,
and record ID into a per-user idempotency key. Replaying the same source record returns the
existing observation. The database unique constraint also closes concurrent request races.

## Safety Rules

The current rule set is `wellness-triage-v1`. Every assessment stores:

- Rule version
- Status and severity
- Reason code
- Patient-facing explanation
- Explicit `isDiagnosis: false`

Questionable observations return `VERIFY_READING` and do not trigger a medical alert. Alert
notifications exclude the measurement value so sensitive readings are not exposed on a lock
screen. Critical alerts have a five-minute cooldown; other alerts have a thirty-minute cooldown.

Clinical thresholds and patient wording must receive clinician review before a production health
monitoring claim is enabled. An LLM must never change thresholds, severity, or escalation status.

## Migration Runbook

Migration: `20260714180000_harden_health_observations`

1. Back up the production database.
2. Test the migration against a recent database copy.
3. Confirm current `health_metrics` and `device_registries` row counts.
4. Run `npx prisma migrate deploy` during a low-traffic window.
5. Confirm the same row counts after migration.
6. Confirm historical metrics have a non-null `unit`, `quality`, and `receivedAt`.
7. Deploy the API only after migration succeeds.
8. Smoke-test one manual metric, one simulator metric, and an idempotent replay.

The migration is additive. It does not modify medicine, schedule, dose-log, or notification data.
The supplied `down.sql` removes added columns and indexes, but intentionally retains new enum
values to avoid rebuilding and locking live PostgreSQL enum dependencies.

## Android Health Connect: Implemented Read-Only Slice

The Android app now includes a native Capacitor bridge built on the stable Health Connect 1.1.0
SDK. It reads heart rate, oxygen saturation, blood pressure, and blood glucose only after the
patient grants the corresponding permissions. The Settings screen provides connect/pause,
manual foreground sync, current access status, and a direct Manage access action.

Production boundaries:

- No write or background Health Connect permissions are requested.
- Sync is patient-initiated and limited to the previous 24 hours per action.
- Native reads are capped at 500 records; API writes are chunked into batches of at most 200.
- Health Connect record IDs provide replay-safe idempotency.
- Observed time, zone offset, and originating package are preserved.
- Each item is independently reported as imported, duplicate, or rejected.
- Because a patient JWT does not prove that a request came from an untampered Android app,
  imported records remain `QUESTIONABLE` with `UNATTESTED_MOBILE_CLIENT` and cannot trigger
  health alerts. Play Integrity attestation is required before promoting this source to trusted.

Android compatibility changed intentionally: `minSdk` is 26, `compileSdk` is 36, and `targetSdk`
remains 35. Health Connect itself requires Android 9 or newer and Google Play services. Android
13 and older also require the Health Connect app from Google Play.

Before Play distribution, complete the Health apps declaration in Play Console for exactly the
four read data types, publish the same privacy rationale used by the Android activity, and test
permission grant, partial grant, revocation, provider update, no-data, large-batch, and replay
scenarios on Android 13 and Android 14+.

Direct BLE comes after Health Connect and initially supports only allowlisted devices implementing
standard Bluetooth health services. The current browser Bluetooth flow remains a simulator and
must not be presented as production medical-device support.
