# Engineering conventions

- Use TypeScript strict mode and the `@/*` alias for `src/*` imports.
- Keep business rules in module-owned domain/application code, not pages, components, or route handlers.
- Keep server-only infrastructure under `src/server`; never import it into a client component.
- Validate untrusted input at boundaries with Zod. Server validation remains authoritative when a client also validates for feedback.
- Add dependencies only for an immediate need, pin stable versions, and commit `pnpm-lock.yaml`.
- Prefer named, focused files over generic dumping grounds. Avoid circular dependencies and TypeScript escape hatches.
- Add directories only when they contain an immediate implementation.
- Update the relevant documentation and decision register when a contract or architecture rule changes.

Formatting is owned by Prettier and code correctness by ESLint/TypeScript. Run `pnpm verify` before handing off a change.

Prisma 7 uses the `prisma-client` generator with explicit output under ignored `src/generated/`, plus the PostgreSQL driver adapter. Run `pnpm db:generate` after install and after schema changes.
