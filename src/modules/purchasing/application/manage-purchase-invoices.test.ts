import { describe, expect, it, vi } from "vitest";

import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import {
  cancelPurchaseInvoice,
  postPurchaseInvoice,
  reversePurchaseInvoice,
  savePurchaseInvoice,
} from "./manage-purchase-invoices";
import type { PurchaseInvoiceRepository } from "./purchase-invoice-contracts";

const actor: ApplicationPrincipal = {
  id: "00000000-0000-4000-8000-000000000001",
  active: true,
  email: "purchasing@example.com",
  name: "Purchasing Manager",
  roleCodes: ["ADMIN"],
  permissions: ["purchasing.manage"],
};

const poLineId = "00000000-0000-4000-8000-000000000002";
const grnLineId = "00000000-0000-4000-8000-000000000003";
const supplierId = "00000000-0000-4000-8000-000000000004";
const invoiceId = "00000000-0000-4000-8000-000000000009";

const form = {
  supplierId,
  supplierInvoiceNumber: "SUP-INV-001",
  invoiceDate: "2026-09-14",
  dueDate: "2026-10-14",
  notes: "",
  linesJson: JSON.stringify([
    {
      purchaseOrderLineId: poLineId,
      invoicedQuantity: "10",
      invoicedUnitRate: "100",
      taxPercent: "13",
      matches: [{ goodsReceiptLineId: grnLineId, matchedQuantity: "10" }],
    },
  ]),
};

function repository(): PurchaseInvoiceRepository {
  return {
    listEligiblePurchaseOrderLines: vi.fn().mockResolvedValue([]),
    listEligibleGoodsReceiptLines: vi.fn().mockResolvedValue([]),
    listInvoiceSuppliers: vi.fn().mockResolvedValue([]),
    createPurchaseInvoice: vi.fn().mockResolvedValue(invoiceId),
    updatePurchaseInvoice: vi.fn().mockResolvedValue(invoiceId),
    postPurchaseInvoice: vi.fn(),
    cancelPurchaseInvoice: vi.fn(),
    reversePurchaseInvoice: vi.fn(),
    getPurchaseInvoice: vi.fn().mockResolvedValue(null),
    listPurchaseInvoices: vi
      .fn()
      .mockResolvedValue({ records: [], page: 1, pageCount: 1, total: 0 }),
  };
}

describe("savePurchaseInvoice", () => {
  it("creates a draft with validated lines and matches", async () => {
    const repo = repository();
    const result = await savePurchaseInvoice(actor, form, repo);

    expect(result).toEqual({ ok: true, id: invoiceId });
    expect(repo.createPurchaseInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        supplierId,
        supplierInvoiceNumber: "SUP-INV-001",
        actorUserId: actor.id,
        lines: [
          expect.objectContaining({
            purchaseOrderLineId: poLineId,
            invoicedQuantity: "10",
            matches: [{ goodsReceiptLineId: grnLineId, matchedQuantity: "10" }],
          }),
        ],
      }),
    );
  });

  it("allows a DRAFT line with zero GRN matches (pre-GRN invoice)", async () => {
    const repo = repository();
    const preGrnForm = {
      ...form,
      linesJson: JSON.stringify([
        {
          purchaseOrderLineId: poLineId,
          invoicedQuantity: "10",
          invoicedUnitRate: "100",
          taxPercent: "13",
          matches: [],
        },
      ]),
    };
    const result = await savePurchaseInvoice(actor, preGrnForm, repo);
    expect(result.ok).toBe(true);
    expect(repo.createPurchaseInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ lines: [expect.objectContaining({ matches: [] })] }),
    );
  });

  it("requires purchasing.manage", async () => {
    const repo = repository();
    const result = await savePurchaseInvoice(
      { ...actor, permissions: ["purchasing.view"] },
      form,
      repo,
    );
    expect(result).toEqual({ ok: false, message: "Purchasing management permission is required." });
    expect(repo.createPurchaseInvoice).not.toHaveBeenCalled();
  });

  it("rejects malformed line JSON", async () => {
    const repo = repository();
    const result = await savePurchaseInvoice(actor, { ...form, linesJson: "not json" }, repo);
    expect(result.ok).toBe(false);
    expect(repo.createPurchaseInvoice).not.toHaveBeenCalled();
  });

  it("rejects a missing supplier invoice number", async () => {
    const repo = repository();
    const result = await savePurchaseInvoice(actor, { ...form, supplierInvoiceNumber: "" }, repo);
    expect(result.ok).toBe(false);
    expect(repo.createPurchaseInvoice).not.toHaveBeenCalled();
  });

  it("edits an existing draft through updatePurchaseInvoice", async () => {
    const repo = repository();
    const result = await savePurchaseInvoice(actor, { ...form, id: invoiceId }, repo);
    expect(result).toEqual({ ok: true, id: invoiceId });
    expect(repo.updatePurchaseInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ id: invoiceId }),
    );
  });

  it("surfaces a repository conflict message (e.g. duplicate supplier invoice number)", async () => {
    const repo = repository();
    repo.createPurchaseInvoice = vi
      .fn()
      .mockRejectedValue(
        new Error("An invoice with this supplier and invoice number already exists."),
      );
    const result = await savePurchaseInvoice(actor, form, repo);
    expect(result).toEqual({
      ok: false,
      message: "An invoice with this supplier and invoice number already exists.",
    });
  });
});

describe("postPurchaseInvoice", () => {
  it("posts through the repository", async () => {
    const repo = repository();
    const result = await postPurchaseInvoice(actor, invoiceId, repo);
    expect(result).toEqual({ ok: true, id: invoiceId });
    expect(repo.postPurchaseInvoice).toHaveBeenCalledWith(invoiceId, actor.id);
  });

  it("requires purchasing.manage", async () => {
    const repo = repository();
    const result = await postPurchaseInvoice(
      { ...actor, permissions: ["purchasing.view"] },
      invoiceId,
      repo,
    );
    expect(result.ok).toBe(false);
    expect(repo.postPurchaseInvoice).not.toHaveBeenCalled();
  });

  it("surfaces incomplete-matching rejection from the repository", async () => {
    const repo = repository();
    repo.postPurchaseInvoice = vi
      .fn()
      .mockRejectedValue(new Error("Line 1 is not fully matched to received quantity."));
    const result = await postPurchaseInvoice(actor, invoiceId, repo);
    expect(result).toEqual({
      ok: false,
      message: "Line 1 is not fully matched to received quantity.",
    });
  });
});

describe("cancelPurchaseInvoice", () => {
  it("cancels a draft with a reason", async () => {
    const repo = repository();
    const result = await cancelPurchaseInvoice(actor, invoiceId, "Entered in error", repo);
    expect(result).toEqual({ ok: true, id: invoiceId });
    expect(repo.cancelPurchaseInvoice).toHaveBeenCalledWith(
      invoiceId,
      "Entered in error",
      actor.id,
    );
  });

  it("rejects a reason shorter than 3 characters", async () => {
    const repo = repository();
    const result = await cancelPurchaseInvoice(actor, invoiceId, "no", repo);
    expect(result.ok).toBe(false);
    expect(repo.cancelPurchaseInvoice).not.toHaveBeenCalled();
  });
});

describe("reversePurchaseInvoice", () => {
  it("reverses a posted invoice with a reason", async () => {
    const repo = repository();
    const result = await reversePurchaseInvoice(actor, invoiceId, "Duplicate entry", repo);
    expect(result).toEqual({ ok: true, id: invoiceId });
    expect(repo.reversePurchaseInvoice).toHaveBeenCalledWith(
      invoiceId,
      "Duplicate entry",
      actor.id,
    );
  });

  it("requires purchasing.manage", async () => {
    const repo = repository();
    const result = await reversePurchaseInvoice(
      { ...actor, permissions: [] },
      invoiceId,
      "Duplicate entry",
      repo,
    );
    expect(result.ok).toBe(false);
    expect(repo.reversePurchaseInvoice).not.toHaveBeenCalled();
  });

  it("surfaces a closed-period rejection from the repository", async () => {
    const repo = repository();
    repo.reversePurchaseInvoice = vi
      .fn()
      .mockRejectedValue(new Error("No OPEN accounting period contains the journal date."));
    const result = await reversePurchaseInvoice(actor, invoiceId, "Duplicate entry", repo);
    expect(result).toEqual({
      ok: false,
      message: "No OPEN accounting period contains the journal date.",
    });
  });
});
