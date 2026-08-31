-- DECIMAL(24,6) retains its declared scale, so scale(value) cannot distinguish
-- whole-piece values from fractional ones. Preserve the intended whole-piece
-- invariant without rejecting every nonzero planned total.
ALTER TABLE "production_batch"
  DROP CONSTRAINT "production_batch_packaging_ck",
  ADD CONSTRAINT "production_batch_packaging_ck"
    CHECK (
      "plannedCartons" >= 0
      AND "plannedLoosePieces" >= 0
      AND "plannedTotalPieces" >= 0
      AND "plannedTotalPieces" = trunc("plannedTotalPieces")
    );
