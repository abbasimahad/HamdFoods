# Phase 3 Authentication and RBAC Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved private email/password authentication, active-user enforcement, database-backed RBAC, administrator workflows, and protected ERP shell.

**Architecture:** Better Auth 1.7.1 owns credentials and sessions through the existing Prisma/PostgreSQL infrastructure. A focused access-control module owns typed permissions, role invariants, application use cases, and persistence ports; Prisma adapters and App Router presentation depend on those contracts. Protected server components and actions are authoritative, while navigation filtering is presentation only.

**Tech Stack:** TypeScript 6, Next.js 16 App Router, React 19, Better Auth 1.7.1, Better Auth Prisma adapter 1.7.1, Prisma 7.9.1, PostgreSQL 18, Zod 4, Vitest 4, Tailwind CSS 4.

## Global Constraints

- Use `docs/specs/2026-08-23-authentication-rbac-design.md` as the approved source of truth; do not redesign it.
- No public self-registration, custom password hashing, client-authoritative authorization, hardcoded role-only access, secrets in client code, destructive user deletion, or Phase 4 master data.
- Better Auth owns password/account/session fields. Application RBAC owns `Role`, `Permission`, `UserRole`, and `RolePermission`.
- Reload active status and permissions from PostgreSQL on every protected server request.
- Preserve the Phase 2 responsive shell and the `/system-health` diagnostic.
- Use recorded red-green cycles for security behavior; generated Prisma client code is exempt.
- Do not commit because the repository has no baseline commit and the user did not authorize commits.

---

### Task 1: Pin Better Auth, validate environment, and define the database schema

**Files:**

- Modify: `package.json`, `pnpm-lock.yaml`, `.env.example`
- Modify: `src/server/env.ts`, `src/server/env.test.ts`
- Create: `src/server/bootstrap-env.ts`, `src/server/bootstrap-env.test.ts`
- Modify: `prisma/schema.prisma`, `prisma.config.ts`
- Create: `prisma/migrations/20260823000000_phase3_auth_rbac/migration.sql`

**Interfaces:**

- Produces `ServerEnv` with `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`.
- Produces `parseBootstrapEnv(input)` for command-only admin name/email/password validation.
- Produces Prisma models `User`, `Session`, `Account`, `Verification`, `Role`, `Permission`, `UserRole`, and `RolePermission`.

- [ ] Add focused failing environment tests for missing auth secret/URL, invalid URL, and bootstrap-only credentials.
- [ ] Run `corepack pnpm@11.22.0 exec vitest run src/server/env.test.ts src/server/bootstrap-env.test.ts`; confirm failures name the missing behavior rather than import errors.
- [ ] Pin `better-auth` and `@better-auth/prisma-adapter` at 1.7.1, add non-secret examples, and implement the environment parsers without loading bootstrap secrets during normal startup.
- [ ] Configure the Better Auth Prisma schema using installed 1.7.1 types/CLI output as evidence, add `User.active`, explicit RBAC joins, unique codes/composite keys, cascade only for session/account/auth joins, and restrictive RBAC foreign keys.
- [ ] Generate a Prisma-owned SQL migration from the schema, review every statement, and keep user/role deletion out of application behavior.
- [ ] Run the focused tests, `pnpm db:validate`, `pnpm db:generate`, and `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`; expect zero errors and migration/schema equivalence.

### Task 2: Implement typed permissions, default roles, and authorization decisions

**Files:**

- Create: `src/modules/access/domain/permissions.ts`
- Create: `src/modules/access/domain/default-roles.ts`
- Create: `src/modules/access/domain/principal.ts`
- Create: `src/modules/access/domain/authorization.test.ts`
- Create: `src/modules/access/application/access-control.ts`

**Interfaces:**

- Produces `PERMISSIONS`, `PermissionCode`, `DEFAULT_ROLE_CODES`, `DefaultRoleCode`, and the approved default role-permission matrix.
- Produces `ApplicationPrincipal`, `hasPermission(principal, permission)`, and pure decisions for active/session/permission access.

- [ ] Add focused failing tests proving authorized access, unauthorized rejection, inactive rejection, multi-role permission deduplication, exact default mappings, and immutable SUPER_ADMIN full access.
- [ ] Run the focused test and confirm the missing authorization contract is the failure.
- [ ] Implement the literal permission registry, role matrix, readonly principal, and pure access decisions without Prisma, React, or Better Auth imports.
- [ ] Rerun the identical focused test and all existing navigation tests; expect all assertions to pass.

### Task 3: Configure Better Auth and prove authentication boundaries

**Files:**

- Create: `src/server/auth/auth.ts`, `src/server/auth/auth-client.ts`
- Create: `src/server/auth/auth-options.ts`, `src/server/auth/auth-options.test.ts`
- Create: `src/app/api/auth/[...all]/route.ts`
- Create: `src/modules/access/application/authenticate-user.ts`
- Create: `src/modules/access/application/authenticate-user.test.ts`

**Interfaces:**

- Produces `auth`, `authClient`, the App Router `GET`/`POST` handler, and `authenticateUser(credentials, gateway)` returning a generic success/failure contract.
- Consumes the existing singleton Prisma client and validated server environment.

- [ ] Add a failing configuration/handler test proving email/password is enabled, signup is disabled, custom password hashing is absent, and the sign-up endpoint rejects creation.
- [ ] Add a failing application test proving valid credentials succeed while wrong credentials, unknown users, inactive users, and dependency failures return one generic invalid-credentials result.
- [ ] Configure the Prisma adapter, Better Auth email/password, Admin plugin only as the supported server credential/session-management boundary, Next.js cookies integration where required, and the catch-all handler. Better Auth's built-in role field must never authorize ERP access.
- [ ] Implement authentication orchestration so inactive users cannot establish usable ERP access and all user-visible credential failures remain generic.
- [ ] Reconcile exports and request shapes against installed 1.7.1 types, then rerun focused tests and TypeScript.

### Task 4: Implement Prisma access repositories, idempotent seed, and SUPER_ADMIN bootstrap

**Files:**

- Create: `src/modules/access/application/ports.ts`
- Create: `src/server/access/prisma-access-repository.ts`
- Create: `src/modules/access/application/seed-access-control.ts`, `seed-access-control.test.ts`
- Create: `src/modules/access/application/bootstrap-super-admin.ts`, `bootstrap-super-admin.test.ts`
- Create: `scripts/seed-access-control.ts`, `scripts/bootstrap-super-admin.ts`
- Modify: `package.json`, `prisma.config.ts`

**Interfaces:**

- Produces repository methods to resolve principals, list users/roles, transact role mappings, count active SUPER_ADMIN users, and revoke sessions.
- Produces `seedAccessControl(dependencies)` and `bootstrapSuperAdmin(input, dependencies)` with idempotent results.

- [ ] Add failing tests showing seed reruns do not duplicate records/mappings and bootstrap reruns normalize email, reuse a user, preserve an existing password, reactivate the account, and avoid duplicate SUPER_ADMIN joins.
- [ ] Implement ports and use cases against deterministic fakes first; confirm green.
- [ ] Implement Prisma adapters with transactions and connect credential creation to Better Auth's supported server API.
- [ ] Add `auth:seed` and `auth:bootstrap` scripts; output success identifiers only, never password, secret, or connection string.
- [ ] Run focused tests twice and, if PostgreSQL is available, execute migration, seed twice, bootstrap twice, and query uniqueness counts.

### Task 5: Implement active-session and permission guards

**Files:**

- Create: `src/server/auth/current-principal.ts`
- Create: `src/server/auth/current-principal.test.ts`
- Create: `src/components/access/access-denied.tsx`
- Modify: every top-level ERP page under `src/app/(erp)`
- Modify: `src/app/(erp)/layout.tsx`, `src/app/(erp)/administration/page.tsx`
- Create: `src/app/(erp)/administration/users/page.tsx`
- Create: `src/app/(erp)/administration/roles-permissions/page.tsx`

**Interfaces:**

- Produces `getCurrentPrincipal()`, `requireUser()`, `requirePermission(code)`, and `requireAnyPermission(codes)`.
- Pages consume the exact route-permission mapping approved in the design.

- [ ] Add failing tests for missing session redirect, inactive-session rejection, permission allowance/denial, administration any-permission access, and fresh permission reload on consecutive requests.
- [ ] Implement session retrieval through `auth.api.getSession({ headers })`, reload the user and role permissions through the repository, and distinguish unauthenticated redirect from authenticated access denial without exposing data.
- [ ] Apply authoritative guards to the ERP layout, each module page, both administration pages, and all later server actions.
- [ ] Rerun focused tests, route tests, lint, and typecheck.

### Task 6: Implement user administration and SUPER_ADMIN safeguards

**Files:**

- Create: `src/modules/access/application/manage-users.ts`, `manage-users.test.ts`
- Create: `src/app/(erp)/administration/users/actions.ts`
- Create: `src/components/access/user-create-form.tsx`
- Create: `src/components/access/user-role-form.tsx`
- Create: `src/components/access/user-status-form.tsx`
- Complete: `src/app/(erp)/administration/users/page.tsx`

**Interfaces:**

- Produces `createManagedUser`, `replaceUserRoles`, and `setUserActive` use cases with explicit actor principal, input, and repository/auth gateway dependencies.
- Server actions return discriminated success/validation/conflict/forbidden results and revalidate the users route.

- [ ] Add failing tests for authorized creation, unauthorized mutation, password non-retention, non-protected role assignment, session revocation on deactivation, self-deactivation/demotion rejection, non-SUPER_ADMIN protected-role rejection, and last-active-SUPER_ADMIN protection.
- [ ] Implement Zod boundary schemas and application invariants, then Prisma/Better Auth side effects in transactional order that cannot leave an active invalid state.
- [ ] Build the responsive server-rendered user table and focused pending-state forms with generic safe feedback and no deletion control.
- [ ] Rerun focused tests, typecheck, and lint.

### Task 7: Implement role-permission administration

**Files:**

- Create: `src/modules/access/application/manage-role-permissions.ts`, `manage-role-permissions.test.ts`
- Create: `src/app/(erp)/administration/roles-permissions/actions.ts`
- Create: `src/components/access/role-permission-form.tsx`
- Complete: `src/app/(erp)/administration/roles-permissions/page.tsx`

**Interfaces:**

- Produces `replaceRolePermissions(actor, roleCode, submittedCodes, repository)` with typed validation, deduplication, transactional replacement, and protected-role behavior.

- [ ] Add failing tests for missing `roles.manage`, unknown permission rejection, duplicate normalization, transactional replacement, and immutable SUPER_ADMIN mappings.
- [ ] Implement the use case and Prisma adapter call; no custom role creation or deletion.
- [ ] Build an accessible role selector and permission matrix with pending/success/error feedback; disable SUPER_ADMIN editing in UI while retaining server rejection.
- [ ] Rerun focused tests, typecheck, and lint.

### Task 8: Integrate login, logout, identity, and permission-aware navigation

**Files:**

- Add: `src/app/login/page.tsx`
- Create: `src/components/auth/login-form.tsx`, `src/components/auth/logout-button.tsx`
- Modify: `src/config/navigation.ts`, `src/config/navigation.test.ts`
- Modify: `src/components/layout/app-shell.tsx`, `sidebar-navigation.tsx`, `top-header.tsx`
- Create: `src/components/layout/permission-navigation.test.ts`

**Interfaces:**

- Navigation items declare required permission codes; `getPermittedNavigation(principal)` filters top-level and Administration child links.
- Login/logout components consume only Better Auth client methods and generic form results.

- [ ] Add failing tests for SALES navigation exclusion, SUPER_ADMIN full visibility, Administration any-permission visibility, real Users/Roles links, authenticated login redirect, and logout session invalidation contract.
- [ ] Implement the Phase 2-compatible login screen, remember-me sign-in, generic invalid-credentials feedback, duplicate-submit prevention, signed-in header identity, logout, and permission-filtered desktop/mobile navigation.
- [ ] Keep Settings/Audit Log planned and non-navigable; activate only Users and Roles & Permissions child links.
- [ ] Rerun focused tests and the complete test suite.

### Task 9: Verify runtime, document Phase 3, and audit scope

**Files:**

- Modify after verification: `docs/phases/current.md`, `README.md`, `docs/engineering/security.md`, `docs/architecture/overview.md`, `docs/architecture/boundaries.md`
- Keep unchanged: all Phase 4 item/unit/master-data paths and models

**Interfaces:**

- Documentation records only demonstrated behavior and exact bootstrap/migration commands.

- [ ] Run process-local environment verification: formatting, ESLint, all Vitest tests, Prisma validate/generate, strict TypeScript, and Next.js production build.
- [ ] If development PostgreSQL is available, apply the checked-in migration, seed twice, bootstrap twice, start the production server, and execute real browser/API assertions for signup rejection, valid/invalid login, route redirects, role-filtered navigation, user/role administration, inactivity, logout, and SUPER_ADMIN safeguards.
- [ ] If PostgreSQL is unavailable, report real database authentication/runtime criteria as unresolved; do not substitute schema or mocked tests for a pass.
- [ ] Inspect the complete tree for forbidden Phase 4 models/routes, `any`, exposed secrets, unguarded mutations, destructive deletion, and role-name-only ordinary authorization.
- [ ] Update `docs/phases/current.md` only after evidence is final; update architecture/security docs because authentication and authorization trust boundaries materially change.
- [ ] Run the full aggregate verification again on the exact documented tree and obtain an independent completion audit.

## Unresolved product decisions

None. Live PostgreSQL availability affects which acceptance criteria can be verified and therefore whether the result is PASS or PARTIAL, but it does not change the approved implementation design.
