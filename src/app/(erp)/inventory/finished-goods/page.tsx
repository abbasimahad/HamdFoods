import { ItemMasterPage } from "@/components/master-data/item-master-page";
import { saveFinishedGoodAction, setFinishedGoodStatusAction } from "./actions";

export default function FinishedGoodsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  return (
    <ItemMasterPage
      description="Define finished products and review exact derived carton content without creating stock balances."
      itemType="FINISHED_GOOD"
      route="/inventory/finished-goods"
      saveAction={saveFinishedGoodAction}
      searchParams={searchParams}
      statusAction={setFinishedGoodStatusAction}
      title="Finished Goods"
    />
  );
}
