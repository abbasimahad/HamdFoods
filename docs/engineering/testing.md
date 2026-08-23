# Testing strategy

Vitest owns unit and server-side integration tests. Tests should exercise public behavior and protect a realistic failure rather than mirror implementation details.

Current meaningful coverage verifies:

- missing mandatory database configuration fails with an actionable variable name;
- a rejected database probe is reported as unavailable instead of healthy.

Use focused tests while developing, then run:

```powershell
pnpm test
pnpm verify
```

`pnpm verify` checks formatting, lint, tests, Prisma schema/client generation, strict types, and the production build. Live database connectivity is intentionally separate:

```powershell
pnpm db:check
```

Playwright is reserved for a later E2E phase. Do not add it until end-to-end workflows exist.
