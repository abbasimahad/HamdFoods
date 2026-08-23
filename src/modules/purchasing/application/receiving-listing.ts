import { GOODS_RECEIPT_STATUSES, type GoodsReceiptStatus } from "./receiving-contracts";
export function parseGoodsReceiptStatus(value?: string): GoodsReceiptStatus | undefined {
  return GOODS_RECEIPT_STATUSES.includes(value as GoodsReceiptStatus)
    ? (value as GoodsReceiptStatus)
    : undefined;
}
