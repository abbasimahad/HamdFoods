import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { PrismaCompanyProfileRepository } from "@/server/administration/prisma-company-profile-repository";
import { requireUser } from "@/server/auth/server-guards";

export default async function ErpLayout({ children }: { children: ReactNode }) {
  const [principal, companyProfile] = await Promise.all([
    requireUser(),
    new PrismaCompanyProfileRepository().getCompanyProfile(),
  ]);
  return (
    <AppShell companyName={companyProfile.legalName} principal={principal}>
      {children}
    </AppShell>
  );
}
