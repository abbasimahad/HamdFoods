import { z } from "zod";

import { INVENTORY_MOVEMENT_TYPES, INVENTORY_STATUSES } from "../domain/inventory";
import type { MovementHistoryQuery } from "./contracts";

export function parseInventoryPage(value: unknown) {
  return z.coerce.number().int().positive().catch(1).parse(value);
}

export function parseMovementHistoryQuery(
  input: Record<string, string | string[] | undefined>,
): MovementHistoryQuery {
  const scalar = (key: string) => (typeof input[key] === "string" ? input[key] : undefined);
  const date = (value?: string) => {
    if (!value) return undefined;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(parsed.valueOf()) ? undefined : parsed;
  };
  const movementType = z.enum(INVENTORY_MOVEMENT_TYPES).safeParse(scalar("movementType"));
  const status = z.enum(INVENTORY_STATUSES).safeParse(scalar("status"));
  const dateTo = date(scalar("dateTo"));
  if (dateTo) dateTo.setUTCDate(dateTo.getUTCDate() + 1);
  return {
    page: parseInventoryPage(scalar("page")),
    query: scalar("q")?.trim().slice(0, 120) ?? "",
    warehouseId: scalar("warehouseId") || undefined,
    movementType: movementType.success ? movementType.data : undefined,
    status: status.success ? status.data : undefined,
    dateFrom: date(scalar("dateFrom")),
    dateTo,
  };
}
