import Decimal from "decimal.js";
import { formatQuantity } from "@/components/ui/format-money";

type Amount = { toString(): string } | null | undefined;

/**
 * UX-11: a reprocess result read "GOOD / SCRAP / LOSS 1000 / 0 / 0" -- canonical millilitres with
 * no unit, for what was physically 2 bottles. GOOD is shown in finished pieces (from the posted
 * GOOD output of the linked batch) with its content; scrap and loss keep their content unit.
 */
export function reprocessOutputSummary(document: {
  goodContentOutput: Amount;
  scrapContentOutput: Amount;
  processLossContent: Amount;
  linkedProductionBatch: {
    productContentCanonicalUnit: { symbol: string };
    outputTransactions: readonly { totalPieces: Amount }[];
  } | null;
}) {
  const unit = document.linkedProductionBatch?.productContentCanonicalUnit.symbol ?? "";
  const content = (value: Amount) =>
    value === null || value === undefined ? "-" : `${formatQuantity(value)} ${unit}`.trim();
  const pieces = document.linkedProductionBatch?.outputTransactions.reduce(
    (total, row) => total.add(row.totalPieces?.toString() ?? "0"),
    new Decimal(0),
  );
  const good =
    pieces && pieces.gt(0)
      ? `${formatQuantity(pieces.toFixed())} pcs (${content(document.goodContentOutput)})`
      : content(document.goodContentOutput);
  return `GOOD ${good} / scrap ${content(document.scrapContentOutput)} / loss ${content(document.processLossContent)}`;
}
