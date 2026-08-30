import Decimal from "decimal.js";

export function inspectionClassificationsReconcile(
  returnedQuantity: string,
  classifiedQuantities: readonly string[],
) {
  const classified = classifiedQuantities.reduce(
    (total, quantity) => total.add(quantity),
    new Decimal(0),
  );
  return classified.eq(returnedQuantity);
}
