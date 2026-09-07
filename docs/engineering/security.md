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
- `AUTH_BYPASS_ENABLED=true` is a temporary server-only local-development convenience. It resolves a deterministic in-memory development principal through the normal principal boundary and centralized SUPER_ADMIN permission set; it does not disable permission guards, create a database user, trust client input, or enable signup. Environment validation fails closed with `Authentication bypass cannot be enabled in production.` whenever either `APP_ENV` or `NODE_ENV` identifies production. Customer installations must leave it disabled. Before commercial or final UAT, disable the bypass and repeat normal Better Auth login, authorization, logout, and unauthenticated-route checks.

### Account security and recovery

- Authenticated users manage their display name, login email, and password at `/account/security`. Login email remains the sole username model: it is normalized, unique, and confirmed with the current password before change. Password changes require the current password and matching confirmation. Display-name changes never change roles or permissions.
- Better Auth's configured verifier, hasher, credential adapter, and sessions remain authoritative. Successful login-email changes and password changes revoke every session for that user. Administrators require `users.manage` to reset another user's password; only a SUPER_ADMIN may reset a SUPER_ADMIN. Reset never changes the target's roles, permissions, active status, or email and revokes all target sessions.
- The public `/forgot-password` page is guidance only. It never accepts credentials or exposes a reset mutation. Public email/password signup remains disabled. There is no master, universal, or hardcoded recovery password and no remote reset-any-password API.
- Offline recovery exists only as the installed local Windows utility. Its process independently requires an elevated high-integrity Administrator token. It lists only active administrative account display name, login email, roles, and status; password input is hidden and sent to the bundled process only over redirected standard input, never arguments, environment diagnostics, task XML, or logs.
- `PROFILE_UPDATED`, `LOGIN_EMAIL_CHANGED`, `PASSWORD_CHANGED`, `ADMIN_PASSWORD_RESET`, and `LOCAL_ACCOUNT_RECOVERY` are non-secret audit classifications. Audit data may contain the affected identifier and change classification but must never contain a plaintext password, password hash, session token, database URL/password, or Better Auth secret.

Rate limiting, 2FA, password-reset delivery, production transport security, secret rotation, the immutable audit engine, and deployment hardening remain later-phase work.
