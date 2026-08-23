# Architectural boundaries

Dependencies point inward toward business rules:

```text
presentation → application → domain
                         ↑
              infrastructure adapter
```

## Presentation

`src/app` and `src/components` render data and collect user intent. Protected pages call server guards, and server actions call application use cases. Components may filter navigation from a server-resolved principal but never make authoritative permission decisions.

## Application

Each module's `application` layer coordinates use cases and defines the ports it needs. The access application layer owns authorization checks, user-management operations, role-permission replacement, and SUPER_ADMIN preservation rules.

## Domain

Domain code expresses business invariants without depending on React, Next.js, Prisma, or transport details. The access domain defines typed permission codes, default roles, principals, and pure permission membership.

## Persistence and infrastructure

`src/server` supplies implementations for application ports. Better Auth is the sole credential/session implementation. Prisma queries stay in database adapters/repositories; generated Prisma types do not become the public contracts between modules.

Modules should call another module through an explicit application-level contract, not reach into its persistence internals. Shared generic files such as giant `utils.ts`, `services.ts`, or `types.ts` are prohibited.
