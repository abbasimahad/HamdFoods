import { ItemMasterPage } from "@/components/master-data/item-master-page";
import { saveRawMaterialAction, setRawMaterialStatusAction } from "./actions";

export default function RawMaterialsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  return (
    <ItemMasterPage
      description="Maintain ingredient and processing-material definitions without stock quantities."
      itemType="RAW_MATERIAL"
      route="/inventory/raw-materials"
      saveAction={saveRawMaterialAction}
      searchParams={searchParams}
      statusAction={setRawMaterialStatusAction}
      title="Raw Materials"
    />
  );
}
