# Security Exceptions

## GHSA-qwww-vcr4-c8h2

- **Package:** `react-router@7.18.1`
- **Accepted until:** 2026-09-15
- **Scope:** Web client only
- **Owner:** MediTrack release owner
- **Reason:** The advisory affects only React Router's unstable React Server
  Components APIs. MediTrack is a Vite client-side SPA and does not use React
  Router RSC APIs, server actions, or an RSC request handler.
- **Compensating control:** `tools/audit-frontend-production.mjs` checks the
  installed version, scans the web source for RSC markers, rejects every other
  high/critical advisory, and fails after the expiry date.
- **Removal:** Upgrade to a patched React Router release as soon as one is
  available for the current major line, then delete this exception and restore
  the direct audit command.

This is not a general vulnerability waiver. CI must remain fail-closed for any
new high or critical production dependency advisory.
