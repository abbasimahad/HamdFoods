"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Icon } from "@/components/ui/icon";
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
      aria-label={pending ? "Signing out" : "Log out"}
      className="grid size-11 shrink-0 place-items-center rounded-lg border border-[var(--border)] bg-white text-xs font-semibold text-[var(--ink)] disabled:opacity-60 sm:flex sm:w-auto sm:px-3"
      disabled={pending}
      onClick={logout}
      type="button"
    >
      <Icon className="size-5 sm:hidden" name="logout" />
      <span className="hidden sm:inline">{pending ? "Signing out…" : "Log out"}</span>
    </button>
  );
}
