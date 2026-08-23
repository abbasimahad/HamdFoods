# Architecture overview

Factory ERP is a modular monolith deployed as one Next.js application backed by one PostgreSQL database. It is not a microservice system.

The runtime path is:

```text
Browser → Next.js server → application use case → persistence adapter → PostgreSQL
```

The browser is a presentation client. Server code owns permissions, quantities, money, balances, costs, discounts, stock movements, and all other consequential decisions. PostgreSQL is the durable source of truth.

## Current structure

- `src/app/`: App Router entry points and server-rendered composition
- `src/components/`: reusable presentation components with no business decisions
- `src/modules/<module>/`: module-owned application and domain code; `access` owns Phase 3 permissions and administration invariants
- `src/server/`: environment validation, Better Auth integration, Prisma repositories, and other server-only infrastructure
- `prisma/`: database schema and checked-in migrations

Authentication and authorization have separate ownership: Better Auth manages identity credentials and sessions, while the access module manages active-user policy, relational roles, permissions, and SUPER_ADMIN invariants. PostgreSQL is re-read for every protected request so deactivation and role changes take effect immediately.

The UI uses Tailwind CSS with CSS variables and local component ownership, which keeps it compatible with future shadcn/ui adoption without installing a component library prematurely.
