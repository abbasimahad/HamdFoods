"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { authClient } from "@/server/auth/auth-client";

export function LogoutButton() {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function logout() {
    setPending(true);
    await authClient.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      className="min-h-11 rounded-lg border border-[var(--border)] bg-white px-3 text-xs font-semibold text-[var(--ink)] disabled:opacity-60"
      disabled={pending}
      onClick={logout}
      type="button"
    >
      {pending ? "Signing out…" : "Log out"}
    </button>
  );
}
