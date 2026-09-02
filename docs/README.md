# Documentation map

This directory is the durable source of project context. Read only the documents relevant to a change, starting here.

## Architecture

- [`architecture/overview.md`](architecture/overview.md): system shape and runtime request path
- [`architecture/boundaries.md`](architecture/boundaries.md): dependency direction and code ownership
- [`architecture/data-integrity.md`](architecture/data-integrity.md): financial, inventory, transaction, and audit invariants

## Product

- [`product/overview.md`](product/overview.md): known scope and long-term flows
- [`product/domain-glossary.md`](product/domain-glossary.md): canonical domain terms and quantity decisions

## Engineering

- [`engineering/conventions.md`](engineering/conventions.md): repository and implementation conventions
- [`engineering/testing.md`](engineering/testing.md): test layers and verification commands
- [`engineering/security.md`](engineering/security.md): trust boundaries and secret handling
- [`testing/core-test-strategy.md`](testing/core-test-strategy.md): Phase 26 invariant coverage and safe integration-database boundary
- [`testing/e2e-test-strategy.md`](testing/e2e-test-strategy.md): Phase 27 disposable PostgreSQL and Chromium regression layers

## Operations

- [`operations/backup-and-recovery.md`](operations/backup-and-recovery.md): Phase 28 logical backups, guarded restore, retention, and restore drills
- [`operations/production-deployment.md`](operations/production-deployment.md): Phase 30 native Windows localhost-only deployment and factory-PC operations
- [`pwa/mobile-pwa.md`](pwa/mobile-pwa.md): Phase 29 installability, conservative caching, offline boundaries, and responsive mobile use

## Project control

- [`decisions/README.md`](decisions/README.md): accepted architectural decisions
- [`phases/current.md`](phases/current.md): active phase, evidence, and next gate
