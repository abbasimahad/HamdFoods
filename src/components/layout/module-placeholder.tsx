import { EmptyState } from "@/components/ui/empty-state";
import { ResponsiveContainer } from "@/components/ui/responsive-container";

import { PageHeader } from "./page-header";

export function ModulePlaceholder({
  moduleName,
  description,
}: {
  moduleName: string;
  description: string;
}) {
  return (
    <ResponsiveContainer>
      <PageHeader description={description} title={moduleName} />
      <EmptyState
        description={`${moduleName} workflows are deliberately deferred to a later delivery phase. This page currently validates the application shell and navigation only.`}
        title={`${moduleName} workspace coming later`}
      />
    </ResponsiveContainer>
  );
}
