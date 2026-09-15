import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { PrismaCompanyProfileRepository } from "@/server/administration/prisma-company-profile-repository";
import { requireUser } from "@/server/auth/server-guards";
import { getLicenseStatus, type LicenseStatus } from "@/server/licensing/license-service";

export default async function ErpLayout({ children }: { children: ReactNode }) {
  const [principal, companyProfile] = await Promise.all([
    requireUser(),
    new PrismaCompanyProfileRepository().getCompanyProfile(),
  ]);
  const licenseBanner = licenseBannerFor(getLicenseStatus());
  return (
    <AppShell
      companyName={companyProfile.legalName}
      licenseBanner={licenseBanner}
      principal={principal}
    >
      {children}
    </AppShell>
  );
}

function licenseBannerFor(
  status: LicenseStatus,
): { message: string; tone: "warning" | "restricted" } | null {
  switch (status.state) {
    case "VALID":
      return null;
    case "SETUP_GRACE":
      return {
        tone: "warning",
        message: `Unlicensed installation — ${status.daysRemaining} day(s) remaining before restriction. An administrator can activate this installation from Administration › License.`,
      };
    case "EXPIRY_GRACE":
      return {
        tone: "warning",
        message: `License expired — ${status.daysRemaining} day(s) remaining before restriction. Contact Hamd Foods to renew.`,
      };
    default:
      return {
        tone: "restricted",
        message:
          "This installation is not licensed. Contact Hamd Foods to activate. Reading, printing, reporting, backup, and restore remain available.",
      };
  }
}
