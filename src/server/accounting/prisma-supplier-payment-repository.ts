import "server-only";

import type {
  SupplierPaymentInput,
  SupplierPaymentRepository,
} from "@/modules/accounting/application/supplier-payment-contracts";
import {
  allocatePostedSupplierPayment,
  cancelSupplierPayment,
  postSupplierPayment,
  reverseSupplierPayment,
  saveSupplierPayment,
} from "./prisma-phase23-repository";

export class PrismaSupplierPaymentRepository implements SupplierPaymentRepository {
  save(actorUserId: string, input: SupplierPaymentInput) {
    return saveSupplierPayment(actorUserId, input);
  }
  post(id: string, actorUserId: string) {
    return postSupplierPayment(id, actorUserId);
  }
  cancel(id: string, actorUserId: string, reason: string) {
    return cancelSupplierPayment(id, actorUserId, reason);
  }
  reverse(id: string, actorUserId: string, reversalDate: Date, reason: string) {
    return reverseSupplierPayment(id, actorUserId, reversalDate, reason);
  }
  allocate(id: string, allocations: SupplierPaymentInput["allocations"], actorUserId: string) {
    return allocatePostedSupplierPayment(id, allocations, actorUserId);
  }
}
