import { UpdatePanel, type UpdateStatusView } from "@/components/administration/update-panel";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { getCurrentAppVersion, getCurrentUpdateStatus } from "@/server/updates/update-service";

import { installUpdateNowAction, uploadUpdatePackageAction } from "./actions";

export default async function AdministrationUpdatesPage() {
  await requirePermission("updates.manage");
  const currentVersion = getCurrentAppVersion();
  const status = getCurrentUpdateStatus();
  const data: UpdateStatusView = {
    currentVersion,
    status:
      status.kind === "known"
        ? {
            kind: "known",
            stage: status.data.stage,
            fromVersion: status.data.fromVersion,
            toVersion: status.data.toVersion,
            updatedAt: status.data.updatedAt,
            rollbackResult: status.data.rollbackResult,
          }
        : { kind: "none" },
  };
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Updates"
        description="Offline signed software updates: verify, install, and recover this installation."
      />
      <Card className="p-5">
        <UpdatePanel
          data={data}
          installUpdateNowAction={installUpdateNowAction}
          uploadUpdatePackageAction={uploadUpdatePackageAction}
        />
      </Card>
    </ResponsiveContainer>
  );
}
