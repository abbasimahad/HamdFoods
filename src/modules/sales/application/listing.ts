export const SALES_PAGE_SIZE = 20;

export function parseSalesPage(value?: string) {
  const page = Number(value ?? "1");
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export function parseOptionalBoolean(value?: string) {
  return value === "active" ? true : value === "inactive" ? false : undefined;
}
