import { z } from "zod";

import { MASTER_PAGE_SIZE } from "../domain/master-data";
import type { ListQuery } from "./contracts";

const searchSchema = z.object({
  q: z.string().trim().max(100).catch(""),
  page: z.coerce.number().int().positive().catch(1),
});

export function parseListQuery(input: {
  q?: string | string[];
  page?: string | string[];
}): ListQuery {
  const parsed = searchSchema.parse({
    q: typeof input.q === "string" ? input.q : "",
    page: typeof input.page === "string" ? input.page : "1",
  });
  return { query: parsed.q, page: parsed.page, pageSize: MASTER_PAGE_SIZE };
}
