import Link from "next/link";

import { Card } from "@/components/ui/card";

export default function ForgotPasswordPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--surface)] p-4">
      <Card className="w-full max-w-lg p-6 sm:p-8">
        <p className="text-sm font-bold text-[var(--accent)]">Hamd Foods ERP</p>
        <h1 className="mt-2 text-2xl font-bold">Account recovery</h1>
        <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
          For offline security, this browser cannot reset an account. On the factory server PC, open{" "}
          <strong>Start Menu → HamdFoods ERP → Account Recovery</strong> and approve the Windows
          Administrator prompt.
        </p>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          The local utility can show active administrative login emails and reset the email,
          password, or both. There is no master password and recovery is not available over the
          network.
        </p>
        <Link
          className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-[var(--accent)] px-4 font-semibold text-white"
          href="/login"
        >
          Return to sign in
        </Link>
      </Card>
    </main>
  );
}
