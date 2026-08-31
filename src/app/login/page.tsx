import { redirect } from "next/navigation";

import { LoginForm } from "@/components/auth/login-form";
import { Card } from "@/components/ui/card";
import { getCurrentPrincipal } from "@/server/auth/server-guards";

export default async function LoginPage() {
  if (await getCurrentPrincipal()) redirect("/dashboard");
  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--surface)] p-4">
      <Card className="w-full max-w-md p-6 sm:p-8">
        <p className="text-sm font-bold text-[var(--accent)]">Hamd Foods ERP</p>
        <h1 className="mt-2 text-2xl font-bold">Sign in</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Use the account provided by your administrator.
        </p>
        <LoginForm />
      </Card>
    </main>
  );
}
