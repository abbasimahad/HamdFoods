import { CompanyProfileForm } from "@/components/administration/company-profile-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaCompanyProfileRepository } from "@/server/administration/prisma-company-profile-repository";
import { saveCompanyProfileAction } from "./actions";

export default async function AdministrationSettingsPage() {
  await requirePermission("settings.manage");
  const profile = await new PrismaCompanyProfileRepository().getCompanyProfile();
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Settings"
        description="Company/factory profile used on printed documents and application branding."
      />
      <Card className="p-5">
        <CompanyProfileForm action={saveCompanyProfileAction} profile={profile} />
      </Card>
    </ResponsiveContainer>
  );
}
