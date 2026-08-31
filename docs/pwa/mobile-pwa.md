# Mobile PWA

Hamd Foods ERP uses one responsive Next.js application for desktop, tablet, and phone access. Phase 29 adds installation metadata and a deliberately conservative service worker; it does not create a native application or a second source of business truth.

**Business transactions require a live server connection.**

## Installation

Chromium can install the application when it is served from HTTPS or localhost. The web app manifest identifies `Hamd Foods ERP`, launches at `/login`, uses standalone display, and supplies 192px, 512px, Apple touch, and maskable-compatible icons. Launching from an installed icon still follows the normal Better Auth login/session redirect and server permission checks.

Browser UI decides when and where an install prompt appears. Phase 29 verifies the ordinary prerequisites: manifest link and fields, icons, secure-context service-worker registration, scope, and control, without relying on a brittle DevTools-only prompt assertion.

## Cache and offline policy

The service worker precaches only the offline fallback and local application icons. It may cache same-origin immutable `/_next/static/` build assets on demand. It does not cache authenticated HTML, React/server data responses, API responses, reports, statements, invoices, payments, journals, audit history, permissions, inventory balances, or mutation responses.

Authenticated navigation is network-only. When navigation cannot reach the server, the worker returns a non-sensitive page explaining that the ERP is offline; it never substitutes a stale operational page. Non-GET requests are not intercepted or cached.

While an open page is offline, a prominent status notice explains that live operations require connectivity. Form submission is rejected before dispatch, the user is told that nothing was sent, and the action must be reviewed and explicitly resubmitted after reconnecting. There is no mutation queue, background replay, IndexedDB ledger, local stock ledger, cached financial truth, or transaction data in local storage.

## Updates

The active worker keeps serving the current compatible shell while a changed worker waits. The UI presents an `Update now` notice; accepting it activates the waiting worker and performs one guarded reload after the controller changes. Old Hamd ERP static cache versions are removed during activation. No forced reload loop or background business action is introduced.

## Mobile behavior

- The mobile header keeps navigation, account identity, and logout reachable without horizontal overflow. The persistent desktop sidebar remains unchanged at desktop width.
- The modal navigation drawer traps focus, closes with Escape or backdrop, returns focus to the menu trigger, closes after navigation, and marks active parent/child routes.
- Forms use single-column phone layouts, viewport-safe controls, visible labels, and at least 44px controls on phone/coarse-pointer devices. Exact server validation and decimal semantics are unchanged.
- Wide operational tables stay inside touch-scrollable horizontal regions so identity, quantity, money, status, and action columns remain available. Finished-goods quantities continue to derive carton/loose presentation from canonical pieces.
- High-risk reason fields and action wording remain present. The navigation modal and inline safety actions remain scrollable and keyboard reachable.
- Existing print CSS excludes ERP/PWA chrome and remains separate from responsive screen behavior.

## Security boundary

The manifest, service worker, icons, and fallback contain no credentials, connection strings, cached permissions, customer/supplier records, financial data, or public secret variables. Better Auth cookies and server-side authorization remain authoritative. Browser caches are not part of PostgreSQL backup or recovery scope.

## Verification

The final Phase 29 evidence is recorded in `docs/phases/current.md`. Playwright covers manifest/icons, service-worker control, offline static/fallback behavior, offline submission rejection, mobile login/navigation, a representative inventory table with carton/loose display, customer-payment form, and manual-journal safety form at phone/tablet widths. Visual evidence is written to the operating-system temporary directory rather than the repository.
