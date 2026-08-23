# Phase 3 Authentication and RBAC Design

**Status:** Approved in conversation on 2026-08-23

## Purpose

Phase 3 adds private, administrator-provisioned ERP access using Better Auth, PostgreSQL, and database-backed permissions. It establishes authentication and module-level authorization without implementing future ERP business workflows.

There is no public registration. Administrators create accounts and provide an initial password through the protected user-management interface. Better Auth owns credential hashing, accounts, sessions, and authentication protocol behavior.

## Scope boundaries

Phase 3 includes:

- email/password login, logout, and session handling;
- active/inactive application users;
- roles, permissions, user-role assignments, and role-permission assignments;
- permission-aware server routes and navigation;
- basic user and role-permission administration;
- idempotent default-role seeding and first-SUPER_ADMIN bootstrap;
- a Prisma migration and focused security tests.

It excludes public registration, OAuth, 2FA, email verification, password-reset email delivery, advanced profiles, destructive user deletion, the full audit engine, PWA work, deployment, and all future ERP domain modules.

## Architecture

Authentication and authorization have separate ownership:

- `src/server/auth` configures Better Auth, its Prisma adapter, request/session integration, and browser client.
- The access-control module owns permission codes, role policy, authorization decisions, user-administration use cases, and persistence ports.
- Prisma repositories implement those ports and keep generated Prisma types out of module contracts.
- App Router pages and server actions call application-layer authorization and mutation interfaces. They do not implement permission rules.
- Client components handle form interaction only. They never decide whether an operation is authorized.

Better Auth is the only password and session implementation. The ERP reloads the current user's active state and permissions from PostgreSQL for protected server requests rather than embedding durable authorization claims in the browser session. This makes deactivation and role changes effective on the next request.

## Data model

Better Auth owns its required `User`, `Session`, `Account`, and `Verification` fields and relations. The generated schema for the pinned stable Better Auth release is the source for exact adapter-required column names and indexes.

The ERP extends `User` with:

- `active`, defaulting to true;
- explicit `UserRole` relations;
- the timestamps already required by Better Auth.

The RBAC schema contains:

- `Role`: stable unique code, display name, system/protected marker, timestamps;
- `Permission`: stable unique `domain.action` code and description;
- `UserRole`: explicit user/role join with a unique composite key;
- `RolePermission`: explicit role/permission join with a unique composite key.

Users, protected system roles, and historical identity records are not destructively deleted in Phase 3. Multi-record changes use PostgreSQL transactions.

## Permission contract

Permission codes are centralized as string literals with a derived TypeScript union:

- `dashboard.view`
- `inventory.view`, `inventory.manage`
- `purchasing.view`, `purchasing.manage`
- `production.view`, `production.manage`
- `sales.view`, `sales.manage`
- `accounting.view`, `accounting.manage`
- `reports.view`
- `users.view`, `users.manage`
- `roles.manage`
- `audit.view`

Permissions, not role-name conditionals, authorize ordinary actions. SUPER_ADMIN protection is an explicit system invariant layered on top of permission checks.

## Default roles

| Role                 | Initial permissions                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `SUPER_ADMIN`        | Every defined permission; permission membership is immutable                                      |
| `ADMIN`              | All module view/manage permissions, reports, users, roles, and audit permissions                  |
| `STORE_KEEPER`       | Dashboard and inventory view/manage                                                               |
| `PRODUCTION_MANAGER` | Dashboard, inventory view, and production view/manage                                             |
| `SALES`              | Dashboard and sales view/manage                                                                   |
| `ACCOUNTS`           | Dashboard, accounting view/manage, and reports view                                               |
| `VIEWER`             | Dashboard plus read-only inventory, purchasing, production, sales, accounting, and reports access |

The seed reconciles permission records, default role records, and their mappings idempotently. It does not create a production credential.

## Authentication flows

### Login

`/login` accepts email, password, and Better Auth's naturally supported remember-me choice. Better Auth validates the credentials with its standard secure password implementation. Invalid credentials, unknown email, and inactive account produce the same generic user-visible failure. Successful login redirects to `/dashboard`.

Public email/password signup is disabled in Better Auth configuration and has no UI or application use case. A direct signup request is rejected.

An authenticated active user visiting `/login` is redirected to `/dashboard`.

### Protected requests

The ERP layout requires a valid session and active database user. Each module page additionally requires its mapped permission:

| Route                               | Permission                                                           |
| ----------------------------------- | -------------------------------------------------------------------- |
| `/dashboard`                        | `dashboard.view`                                                     |
| `/inventory`                        | `inventory.view`                                                     |
| `/purchasing`                       | `purchasing.view`                                                    |
| `/production`                       | `production.view`                                                    |
| `/sales`                            | `sales.view`                                                         |
| `/accounting`                       | `accounting.view`                                                    |
| `/reports`                          | `reports.view`                                                       |
| `/administration`                   | Any of `users.view`, `users.manage`, `roles.manage`, or `audit.view` |
| `/administration/users`             | `users.view`                                                         |
| `/administration/roles-permissions` | `roles.manage`                                                       |

Unauthenticated requests redirect to `/login`. Authenticated requests without the required permission render a non-sensitive access-denied result. Server actions repeat authorization before mutation.

### Logout and deactivation

Logout invalidates the current Better Auth session and returns to `/login`. Deactivating a user marks the account inactive and revokes all of that user's sessions in the same application operation. Protected requests independently reject inactive users, including sessions created before deactivation.

## Authorization interfaces

The server-facing contract provides equivalents of:

- `requireUser()`: returns the current active application principal or redirects/rejects;
- `requirePermission(permission)`: returns an authorized principal or an access-denied result;
- `hasPermission(principal, permission)`: pure permission membership check;
- `resolveUserPermissions(userId)`: loads the union of permissions across all assigned roles.

The principal contains identity and a deduplicated readonly permission set. Presentation code may use it to filter navigation, but filtering never substitutes for a server guard.

## User administration

`/administration/users` is server-rendered and progressively enhanced with focused interactive forms. Authorized administrators can list basic user information, create a user, assign roles, activate a user, and deactivate a user.

The create-user form requires name, email, an administrator-entered initial password, active status, and at least one selected role. The password is sent only to the server and Better Auth, is never stored outside Better Auth's credential record, and is never redisplayed or logged. Better Auth's pinned stable default password validation applies; Phase 3 adds no competing password algorithm or policy.

User-management invariants:

- ordinary users cannot create themselves;
- email uniqueness is enforced by Better Auth/database constraints;
- users are disabled rather than deleted;
- only SUPER_ADMIN may assign or remove the SUPER_ADMIN role;
- no user may deactivate or demote their own current account;
- the last active SUPER_ADMIN cannot be deactivated or demoted.

## Role-permission administration

`/administration/roles-permissions` presents roles and a module-level permission matrix. A `roles.manage` check protects viewing and mutation.

Role-management invariants:

- system roles cannot be deleted in Phase 3;
- SUPER_ADMIN's complete permission set cannot be edited;
- edits replace one role's permission mapping transactionally;
- only known centralized permission codes are accepted;
- a stale or duplicated submitted mapping is normalized to a unique set before persistence.

Custom role creation and role deletion are outside Phase 3; the screen edits the seeded default roles only.

## Navigation and shell integration

The server-resolved principal is passed into the Phase 2 shell. Each top-level navigation item declares its required view permission. Items the principal cannot access are omitted on desktop and mobile. Administration appears when the principal has `users.view`, `users.manage`, `roles.manage`, or `audit.view`.

The Administration submenu activates real links for Users and Roles & Permissions. Settings and Audit Log remain visibly planned only when Administration is visible. The top header shows the authenticated user's name/email and a logout control while retaining the existing responsive behavior.

## Environment and bootstrap

Server configuration adds:

- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `BOOTSTRAP_ADMIN_NAME`
- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_PASSWORD`

Bootstrap credentials are required only by the explicit bootstrap command, not normal application startup. They remain server-only and appear in `.env.example` as non-production placeholders.

`pnpm auth:bootstrap` is idempotent by normalized email. It creates the Better Auth user when absent, or reuses the existing user without overwriting its password. It ensures the user is active and assigned to SUPER_ADMIN without producing duplicate joins. Command output identifies success without printing the password or connection string.

## Errors and security behavior

- Boundary input is validated server-side with Zod.
- Login never distinguishes unknown email, wrong password, or inactive status.
- Authorization denial does not expose protected data.
- Database or Better Auth implementation errors are logged only through non-secret server diagnostics; user-facing responses remain generic.
- Secrets have no `NEXT_PUBLIC_` prefix and are imported only by server-only modules.
- Mutation authorization and invariants execute within the application service before persistence.
- The detailed immutable audit engine remains deferred as required by `docs/architecture/data-integrity.md`; Phase 3 use-case boundaries provide the future insertion points.

## Migration and seed strategy

A checked-in Prisma migration creates the Better Auth and RBAC tables, foreign keys, unique constraints, and indexes. The migration is produced through Prisma tooling rather than live manual database edits. The checked-in seed command reconciles module-level permissions and default-role mappings idempotently.

Migration validation, generation, and application are separate from live connectivity. A real PostgreSQL verification is required to claim database-backed authentication works end to end; if the host still lacks PostgreSQL, that runtime criterion is reported as blocked rather than inferred from schema validation.

## Testing strategy

Development follows recorded red-green cycles at public application boundaries:

- permission membership allows and rejects correctly;
- multi-role resolution returns the deduplicated union;
- protected access rejects missing sessions, inactive users, and missing permissions;
- valid credentials authenticate and invalid credentials fail generically;
- direct public signup is disabled;
- deactivation revokes sessions;
- user and role mutations enforce authorization and SUPER_ADMIN invariants;
- default seeding and bootstrap are idempotent.

Tests use real domain/application code and replace only external session/database boundaries where deterministic isolation is required. Better Auth configuration and handler behavior receive integration coverage. Full verification includes formatting, ESLint, Vitest, Prisma validation/generation, strict TypeScript, the production build, migration status/application where PostgreSQL is available, and browser checks for login, logout, route protection, permission-filtered navigation, and administration forms.

## Acceptance criteria

Phase 3 is complete when:

- no public signup path can create a user;
- the bootstrap command can establish the first SUPER_ADMIN without a source-controlled password;
- active valid users can log in and log out;
- inactive users and invalid credentials cannot establish or use ERP access;
- every ERP route and mutation has an authoritative server permission check;
- navigation reflects, but does not enforce, the principal's permissions;
- authorized administrators can manage users and default role mappings without violating SUPER_ADMIN safeguards;
- the Prisma migration, seed, focused tests, and production build pass;
- documentation records the implementation, default roles, bootstrap procedure, verification, limitations, and next phase.
