# Architecture decision register

Only accepted decisions are listed. Add a focused ADR when a decision needs alternatives, migration consequences, or supersession history.

## 2026-08-23 — Modular monolith

**Status:** accepted. One Next.js application contains domain modules with explicit presentation, application, domain, persistence, and infrastructure boundaries. Microservices are rejected for the current product.

## 2026-08-23 — PostgreSQL and Prisma boundary

**Status:** accepted. PostgreSQL is authoritative. Prisma 7 uses its generated TypeScript client and the `@prisma/adapter-pg` driver behind server-only adapters. The Phase 1 schema deliberately has no business models.

## 2026-08-23 — Local database exposure

**Status:** superseded by the native Windows production-hosting decision. The original Docker Compose development decision is retained only as historical context.

## 2026-09-02 - Native Windows production hosting

**Status:** accepted. Docker is not part of the product architecture. The factory server runs native PostgreSQL and the Next.js standalone runtime under Windows Task Scheduler. PostgreSQL and the ERP bind only to loopback during Phase 30; `DATABASE_URL` must use `127.0.0.1`, `localhost`, or `::1`. Production secrets stay in an ACL-protected, ignored `.env.production`; native PostgreSQL client tools provide the existing Phase 28 backup/recovery mechanism. Phase 31 may introduce a private HTTPS application origin without exposing PostgreSQL.

## 2026-08-23 — Exact financial and inventory history

**Status:** accepted. Precision-sensitive values will use exact decimal arithmetic after domain scales are specified. Inventory will be ledger based, and posted effects will be reversed rather than deleted.
