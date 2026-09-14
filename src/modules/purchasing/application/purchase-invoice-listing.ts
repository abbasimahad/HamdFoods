import {
  PURCHASE_INVOICE_STATUSES,
  type PurchaseInvoiceStatus,
} from "./purchase-invoice-contracts";

export function parsePurchaseInvoiceStatus(value?: string): PurchaseInvoiceStatus | undefined {
  return PURCHASE_INVOICE_STATUSES.find((status) => status === value);
}
