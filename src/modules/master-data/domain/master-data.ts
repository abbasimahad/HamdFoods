export const ITEM_TYPES = ["RAW_MATERIAL", "PACKAGING_MATERIAL", "FINISHED_GOOD"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const UNIT_DIMENSIONS = ["MASS", "VOLUME", "COUNT"] as const;
export type UnitDimension = (typeof UNIT_DIMENSIONS)[number];

export const PACKAGING_KINDS = [
  "BOTTLE",
  "JAR",
  "CAP",
  "LID",
  "LABEL",
  "CARTON",
  "SHRINK_WRAP",
  "SEAL",
  "DIVIDER",
  "BUCKET",
  "OTHER",
] as const;
export type PackagingKind = (typeof PACKAGING_KINDS)[number];

export const MASTER_PAGE_SIZE = 25;

export function normalizeMasterCode(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
}

export function isValidMasterCode(value: string) {
  return /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(value);
}

export function isPositiveDecimalString(value: string) {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(normalized)) return false;
  return /[1-9]/.test(normalized);
}
