# Security rules

The trust boundary is browser → application server → data layer → PostgreSQL. The browser must never connect directly to PostgreSQL or receive database credentials.

- Store secrets only in ignored local environment files or a deployment secret store.
- Only variables deliberately prefixed `NEXT_PUBLIC_` may enter browser bundles; Phase 1 defines none.
- Validate mandatory server configuration at startup and fail with actionable, non-secret errors.
- Bind the local database port to `127.0.0.1`, not all network interfaces.
- Apply least privilege to database roles, application permissions, and deployment access.
- Do not return raw database errors, connection strings, or stack traces in user-facing health output.

## Authentication and authorization

- Better Auth owns password hashing, credentials, sessions, and the public authentication protocol. Its mounted handler disables email/password signup.
- Bootstrap and administrator provisioning are server-only. Passwords are never persisted by application use cases, returned to clients, or logged.
- Protected server requests reload user activity and relational role permissions from PostgreSQL. Browser-visible navigation is presentation filtering, never an authorization boundary.
- Every protected page and mutation repeats an active-user/permission check. Deactivation revokes all sessions, and stale inactive sessions are independently rejected.
- Ordinary authorization uses permission codes, not role-name checks. SUPER_ADMIN role-name checks exist only for its explicit preservation invariants.
- Authentication errors remain generic so unknown email, incorrect password, and inactive status are not distinguished to the user.

Rate limiting, 2FA, password-reset delivery, production transport security, secret rotation, the immutable audit engine, and deployment hardening remain later-phase work.
