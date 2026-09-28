# Caregiver / Family Monitoring

## Scope

Care Circle is an explicit, time-limited, read-only sharing feature for adult patients. It supports medication coordination; it is not emergency monitoring, diagnosis, clinical advice, or authority to change treatment.

V1 intentionally excludes minors. A minor requires a separately verified guardian workflow with age, authority, and revocation controls.

## Consent model

A caregiver is a relationship-scoped capability, not a global account role. One account may be both a patient and a caregiver for different people.

The patient must:

1. Choose an existing active MediTrack account by email.
2. Choose each permission separately.
3. Confirm the account belongs to an adult.
4. Explicitly consent to sharing.
5. Choose an access duration from 30 to 365 days.

The caregiver must sign in with the invited email, review the selected permissions, and acknowledge the privacy responsibilities. The patient can change permissions or revoke access immediately.

Permissions are independent:

- `VIEW_ADHERENCE`: dose statuses and daily completion, without medicine names unless separately shared.
- `VIEW_MEDICATIONS`: active medicine identity and strength.
- `VIEW_REFILLS`: stock and refill attention state.
- `RECEIVE_MISSED_DOSE_ALERTS`: privacy-safe app alerts.

## Security controls

- Invitation secrets are generated with 256 bits of randomness.
- Only a SHA-256 token hash is stored in PostgreSQL.
- The secret is placed in the URL fragment (`#token=...`), which browsers do not send in HTTP requests or ordinary server access logs.
- Invitations expire after seven days and can be accepted only by the intended active account.
- PostgreSQL advisory locking makes invitation acceptance single-use under concurrency.
- A patient can have at most 10 active caregivers and 10 pending invitations.
- Dashboard authorization is evaluated on every request; it is not trusted from the UI or token claims.
- Dashboard reads and consent changes are audited.
- Missed-dose escalation uses a unique relationship/dose key and atomic worker claims, preventing duplicate delivery across overlapping workers.
- Alert title/body omit patient and medicine names. Sensitive details appear only after authenticated access.
- Revocation also disables pending alert deliveries.

## Operations

Apply the additive migration before deploying the API:

```bash
npx prisma migrate deploy
```

The API process runs the escalation cron. At least one continuously running API instance is required for timely alerts. Render free-tier sleep can delay background processing; do not describe this as real-time or emergency monitoring.

Monitor:

- failed escalation count and retry exhaustion;
- active/pending relationship limits;
- audit-log write failures;
- invitation abuse/rate-limit events;
- notification delivery latency.

Never log invitation tokens, medicine names in caregiver lock-screen messages, or full caregiver dashboard responses.

## Regulatory design basis

The implementation follows privacy-by-design principles from:

- India Digital Personal Data Protection Act, 2023: https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf
- Digital Personal Data Protection Rules, 2025: https://www.meity.gov.in/data-protection-framework
- MoHFW Health Data Management Policy: https://abdm.gov.in:8081/uploads/health_data_management_policy_455613409c.pdf

These controls are engineering safeguards, not a legal certification. Production launch still requires legal/privacy review, a published privacy notice, retention policy, incident response, and a verified guardian design before serving minors.