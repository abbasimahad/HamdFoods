import Link from "next/link";

import { StatusCard } from "@/components/system/status-card";
import { routes } from "@/config/navigation";
import { getSystemHealth } from "@/modules/system/application/get-system-health";
import { probeDatabase } from "@/server/db/probe-database";
import { serverEnv } from "@/server/server-env";

export const dynamic = "force-dynamic";

export default async function SystemHealthPage() {
  const health = await getSystemHealth(probeDatabase);
  const databaseConnected = health.database === "connected";

  return (
    <main className="min-h-dvh px-4 py-10 sm:px-8 lg:px-12 lg:py-16">
      <div className="mx-auto w-full max-w-6xl">
        <header className="border-b border-[var(--border)] pb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">
            Phase 1 / Live diagnostic
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-[-0.04em]">System health</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            Server-side checks remain available here without exposing database credentials to the
            browser.
          </p>
        </header>
        <section aria-labelledby="system-status" className="py-9">
          <div className="mb-5 flex items-center justify-between gap-4">
            <h2 className="text-xl font-bold" id="system-status">
              Service status
            </h2>
            <span className="font-mono text-xs text-[var(--muted)]">{serverEnv.APP_ENV}</span>
          </div>
          <div className="border-y border-[var(--border)] bg-[var(--raised)] px-5 md:grid md:grid-cols-3 md:py-7">
            <StatusCard
              detail="Rendered by the Next.js application server."
              label="Application server"
              status="Operational"
              tone="healthy"
              trace="Next.js"
            />
            <StatusCard
              detail="Required server-only environment variables passed validation."
              label="Configuration"
              status="Valid"
              tone="healthy"
              trace="Zod"
            />
            <StatusCard
              detail={
                databaseConnected
                  ? "Prisma completed a PostgreSQL query."
                  : "Start PostgreSQL, then refresh this page."
              }
              label="PostgreSQL database"
              status={databaseConnected ? "Connected" : "Unavailable"}
              tone={databaseConnected ? "healthy" : "unavailable"}
              trace="Prisma"
            />
          </div>
        </section>
        <Link
          className="inline-flex min-h-11 items-center rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white outline-none hover:bg-[var(--accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
          href={routes.dashboard}
        >
          Return to ERP dashboard
        </Link>
      </div>
    </main>
  );
}
