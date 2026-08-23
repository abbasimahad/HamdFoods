import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/server/auth/server-guards";

export default async function ErpLayout({ children }: { children: ReactNode }) {
  const principal = await requireUser();
  return <AppShell principal={principal}>{children}</AppShell>;
}
