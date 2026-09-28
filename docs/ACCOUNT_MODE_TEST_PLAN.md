# Patient and Caregiver Account Mode Test Plan

Use two verified non-admin accounts and one admin account. Do not use real
patient data during release testing.

## Automated gates

- [x] Patient/caregiver mode changes are persisted and tokens are rotated.
- [x] Selecting the current mode is idempotent and does not rewrite the user.
- [x] Admin accounts cannot change into patient or caregiver mode.
- [x] Patient-only and caregiver-only Care endpoints expose role metadata.
- [x] Backend build passes.
- [x] Web typecheck and production build pass.
- [x] Backend and web lint ratchets pass.

## Patient mode

- [ ] Sign in as a patient and confirm the default route is `/dashboard`.
- [ ] Confirm patient navigation shows Dashboard, Analytics, Medicines,
      Medication Safety, Refills, Bills, Dose logs, Prescriptions,
      Notifications, Care Circle, Doctor Reports, and Settings.
- [ ] Confirm Care Circle shows invitations, people with access, permission
      controls, revocation, and recent access history.
- [ ] Search for a medicine and confirm master results load.
- [ ] Open `/care/patients/<id>` directly and confirm the app redirects to the
      patient home without exposing caregiver data.

## Caregiver mode

- [ ] Switch to Caregiver from the account menu and confirm the app opens
      `/care` without a page refresh.
- [ ] Confirm navigation shows only Notifications, Care Circle, and Settings.
- [ ] Confirm Care Circle shows only people who explicitly shared access.
- [ ] Confirm the caregiver can open only a shared patient's permitted fields.
- [ ] Open `/medicines`, `/dashboard`, `/refills`, and `/prescriptions`
      directly and confirm each redirects to `/care`.
- [ ] Confirm caregiver mode does not request patient Care Circle, invitations,
      or patient access-history endpoints.
- [ ] Confirm Settings hides Patient Companion, Health Connect, and manual
      vital entry while retaining mode, theme, notification, and security
      controls.

## Switching and isolation

- [ ] Switch back to Patient and confirm patient features return immediately.
- [ ] Confirm medicines, schedules, caregiver relationships, and notification
      preferences were not deleted or reassigned by either switch.
- [ ] Sign out and sign back in; confirm the last selected mode is retained.
- [ ] Confirm browser back cannot reopen a forbidden role page after switching.
- [ ] Confirm cached patient responses do not appear in caregiver mode.
- [ ] Confirm cached caregiver dashboards do not appear in patient mode.

## Invitations and privileged roles

- [ ] Open a valid caregiver invitation while in Patient mode, switch from the
      prompt, and confirm the same invitation reopens in Caregiver mode.
- [ ] Accept the invitation and confirm only its granted permissions appear.
- [ ] Confirm expired, revoked, wrong-email, and reused invitations fail closed.
- [ ] Sign in as ADMIN and confirm there is no Patient/Caregiver switch.
- [ ] Confirm ADMIN medicine review/import navigation remains available.
- [ ] Confirm a PATIENT or CAREGIVER receives `403` from admin endpoints.

## Mobile and accessibility

- [ ] On Android and a narrow browser, switch modes and confirm the menu closes.
- [ ] Confirm keyboard focus remains usable after switching on desktop.
- [ ] Confirm the active segmented-control option is announced with
      `aria-pressed=true`.
- [ ] Confirm slow or failed mode-switch requests keep the previous mode and
      show an actionable error.

## Release evidence

- [ ] Record the tested commit SHA and environment.
- [ ] Run authenticated production smoke checks with one patient and one
      caregiver account.
- [ ] Attach screenshots of both navigation modes and one denied direct URL.
