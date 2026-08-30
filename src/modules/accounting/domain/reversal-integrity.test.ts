import { describe, expect, it } from "vitest";

import { hasReversalConflict } from "./reversal-integrity";

describe("reversal-chain integrity", () => {
  it("allows an original document without a linked reversal", () => {
    expect(hasReversalConflict({ reversalOfId: null, hasLinkedReversal: false })).toBe(false);
  });

  it("blocks a second reversal of the original", () => {
    expect(hasReversalConflict({ reversalOfId: null, hasLinkedReversal: true })).toBe(true);
  });

  it("blocks reversal of the reversal document", () => {
    expect(hasReversalConflict({ reversalOfId: "original-id", hasLinkedReversal: false })).toBe(
      true,
    );
  });
});
