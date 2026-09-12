import type { ApplicationPrincipal } from "@/modules/access/domain/principal";

export type QuickCreateKind = "customer" | "supplier" | "product" | "material" | "packaging";

export type QuickCreateOption = { value: string; label: string };

export type QuickCreateResult =
  { ok: true; option: QuickCreateOption } | { ok: false; message: string };

export type QuickCreateMutationResult =
  { ok: true; id?: string | undefined } | { ok: false; message: string };

export type QuickCreateDependencies = {
  saveCustomer: (
    actor: ApplicationPrincipal,
    data: Record<string, unknown>,
  ) => Promise<QuickCreateMutationResult>;
  saveSupplier: (
    actor: ApplicationPrincipal,
    data: Record<string, unknown>,
  ) => Promise<QuickCreateMutationResult>;
  saveItem: (
    actor: ApplicationPrincipal,
    data: Record<string, unknown>,
  ) => Promise<QuickCreateMutationResult>;
};
