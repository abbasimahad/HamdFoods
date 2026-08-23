import Link from "next/link";

import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";

export function AccessDenied() {
  return (
    <ResponsiveContainer>
      <Card className="mx-auto max-w-xl p-6 text-center sm:p-8">
        <h1 className="text-xl font-bold">Access denied</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Your account does not have permission to view this workspace.
        </p>
        <Link
          className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white"
          href="/dashboard"
        >
          Return to dashboard
        </Link>
      </Card>
    </ResponsiveContainer>
  );
}
