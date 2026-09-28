# Production Email Notification Acceptance

Status: **PENDING REAL-WORLD TEST**

Do not mark the email notification slice production-approved until every required
case below has passed against the deployed Render, Vercel, Supabase, and Brevo
environment. A provider API acceptance response is not proof of inbox delivery.

## Preconditions

- [ ] The release commit is deployed to Render and Vercel.
- [ ] `npx prisma migrate deploy` completed against the production database.
- [ ] `EMAIL_NOTIFICATIONS_ENABLED=true` is set on Render.
- [ ] `BREVO_API_KEY`, `EMAIL_FROM_ADDRESS`, and `EMAIL_FROM_NAME` are configured.
- [ ] The configured Brevo sender is active and verified.
- [ ] `npm run email:check -- --env-file=.env.production.local` passes locally.
- [ ] A fresh production backup or recovery point exists before testing writes.

## Required Test Cases

Record the timestamp, test account, notification row ID, Brevo message ID, inbox
result, and any corrective action for each case. Never record passwords, tokens,
full email bodies, or other unnecessary medical information in test evidence.

| Test | Expected result | Status |
| --- | --- | --- |
| New-account verification | A unique verification link reaches the registered address and works once. Reuse or expiry is rejected. | Pending |
| Settings test email | An opted-in, verified account receives the test message. | Pending |
| Caregiver invitation | The invited address receives the correct one-time invitation; the UI provides the copy-link fallback when delivery cannot be queued. | Pending |
| Password-change security email | A verified account receives a security notice after a successful password change without exposing credentials. | Pending |
| Missed-dose alert | An opted-in account receives one alert for the event; the local and SMS paths are not suppressed by email failure. | Pending |
| Low-stock/refill alert | An opted-in account receives one alert for the event using the configured refill threshold. | Pending |
| Global email opt-out | No optional medication email is queued or sent while email notifications are disabled. | Pending |
| Category opt-out | Disabled missed-dose or refill categories do not send while other enabled categories continue to work. | Pending |
| Medicine-name privacy | Medicine names are absent by default and appear only after the separate explicit opt-in. | Pending |
| Retry behavior | A transient provider/network failure schedules bounded retry attempts and eventually records success or terminal failure. | Pending |
| Deduplication | Reprocessing the same clinical event does not create a second email delivery. | Pending |

## Provider Evidence

For every message expected to be delivered:

1. Confirm the application `NotificationLog` and `NotificationDelivery` records.
2. Confirm the masked recipient, category, attempt count, provider message ID, and
   final application status.
3. Open Brevo **Transactional > Logs** and record whether the message was
   delivered, deferred, blocked, bounced, or marked as spam.
4. Confirm receipt in the destination inbox and check the spam folder.
5. Treat Brevo API acceptance as `accepted`, not as `delivered`.

## Failure Checks

- [ ] Hard-bounced or invalid recipients do not cause an unbounded retry loop.
- [ ] A Brevo outage does not break local reminders, SMS, password changes, or
      caregiver invitation creation.
- [ ] Logs mask recipient addresses and never contain API keys, tokens, passwords,
      or full clinical email content.
- [ ] Retrying a worker after restart does not duplicate a previously accepted
      message.
- [ ] Concurrent workers cannot claim the same pending delivery simultaneously.

## Approval Decision

Production approval requires:

- all required cases marked Passed;
- no unresolved high-severity privacy or delivery defect;
- Brevo logs and inbox evidence for expected deliveries;
- retry and deduplication evidence;
- documented owner and date for any accepted residual risk.

Final decision: **PENDING**

Approved by:

Approval date:

Release commit:

Evidence location:
