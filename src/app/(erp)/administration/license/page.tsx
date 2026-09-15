import { LicensePanel } from "@/components/administration/license-panel";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { getLicenseStatus } from "@/server/licensing/license-service";

import {
  generateActivationRequestAction,
  importLicenseFileAction,
  resetLocalLicenseStateAction,
} from "./actions";

export default async function AdministrationLicensePage() {
  await requirePermission("license.manage");
  const status = getLicenseStatus({ forceRefresh: true });
  return (
    <ResponsiveContainer>
      <PageHeader
        title="License"
        description="Software license activation and status for this installation."
      />
      <Card className="p-5">
        <LicensePanel
          generateActivationRequestAction={generateActivationRequestAction}
          importLicenseFileAction={importLicenseFileAction}
          resetLocalLicenseStateAction={resetLocalLicenseStateAction}
          status={status}
        />
      </Card>
    </ResponsiveContainer>
  );
}
