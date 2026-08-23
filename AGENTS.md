# Factory ERP

Production-oriented food manufacturing ERP, currently at the Phase 1 foundation. It is a TypeScript modular monolith: Next.js presentation, module-owned application/domain code, server infrastructure, Prisma, and PostgreSQL.

Verify with `pnpm verify`; use `pnpm test` for focused tests and `pnpm db:check` for live database connectivity. Local setup is in `README.md`.

Authoritative context starts at `docs/README.md`; the active gate is `docs/phases/current.md`. Read the relevant architecture, product, and engineering docs before changing a domain.

Non-negotiable rules: server-authoritative business decisions; PostgreSQL as source of truth; exact decimal handling for money and precision-sensitive values; ledger-based inventory; reversals instead of deleting posted transactions; immutable auditability; least privilege; no secrets or direct browser-to-database access. Do not build future-phase modules early.

Update documentation whenever an architectural decision or domain contract changes.
