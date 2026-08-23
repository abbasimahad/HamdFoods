# Architecture decision register

Only accepted decisions are listed. Add a focused ADR when a decision needs alternatives, migration consequences, or supersession history.

## 2026-08-23 — Modular monolith

**Status:** accepted. One Next.js application contains domain modules with explicit presentation, application, domain, persistence, and infrastructure boundaries. Microservices are rejected for the current product.

## 2026-08-23 — PostgreSQL and Prisma boundary

**Status:** accepted. PostgreSQL is authoritative. Prisma 7 uses its generated TypeScript client and the `@prisma/adapter-pg` driver behind server-only adapters. The Phase 1 schema deliberately has no business models.

## 2026-08-23 — Local database exposure

**Status:** accepted. Docker Compose pins PostgreSQL 18.6 Alpine and persists `/var/lib/postgresql`, the PostgreSQL 18 image's volume root. Host access binds to `127.0.0.1` for development only.

## 2026-08-23 — Exact financial and inventory history

**Status:** accepted. Precision-sensitive values will use exact decimal arithmetic after domain scales are specified. Inventory will be ledger based, and posted effects will be reversed rather than deleted.
