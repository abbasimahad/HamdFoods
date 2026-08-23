import { ItemMasterPage } from "@/components/master-data/item-master-page";
import { savePackagingMaterialAction, setPackagingMaterialStatusAction } from "./actions";

export default function PackagingMaterialsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  return (
    <ItemMasterPage
      description="Maintain bottles, jars, closures, labels, cartons, and other packaging definitions."
      itemType="PACKAGING_MATERIAL"
      route="/inventory/packaging-materials"
      saveAction={savePackagingMaterialAction}
      searchParams={searchParams}
      statusAction={setPackagingMaterialStatusAction}
      title="Packaging Materials"
    />
  );
}
