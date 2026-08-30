import type { Prisma } from "@/generated/prisma/client";

export function effectiveCustomerPaymentWhere(asOf?: Date): Prisma.CustomerPaymentWhereInput {
  return effectivePaymentWhere(asOf);
}

export function effectiveSupplierPaymentWhere(asOf?: Date): Prisma.SupplierPaymentWhereInput {
  return effectivePaymentWhere(asOf);
}

export function isEffectivePostedPayment(payment: {
  status: string;
  reversalOfId: string | null;
  reversalPayment: { paymentDate: Date } | null;
}) {
  return (
    payment.status === "POSTED" && payment.reversalOfId === null && payment.reversalPayment === null
  );
}

function effectivePaymentWhere(asOf?: Date) {
  return {
    status: "POSTED" as const,
    reversalOfId: null,
    ...(asOf
      ? {
          paymentDate: { lte: asOf },
          OR: [
            { reversalPayment: { is: null } },
            { reversalPayment: { is: { paymentDate: { gt: asOf } } } },
          ],
        }
      : { reversalPayment: { is: null } }),
  };
}
