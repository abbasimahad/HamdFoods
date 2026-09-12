import { describe, expect, it } from "vitest";

import {
  createSingleFlightGuard,
  createLineKey,
  filterSelectOptions,
  nextActiveOptionIndex,
} from "./data-entry-state";

describe("data-entry state", () => {
  it("finds authorized select options by trimmed label or keyword", () => {
    // Production defect caught: long ERP selects become unusable when search ignores codes or spacing.
    const options = [
      { value: "customer-1", label: "Al Noor Traders", keywords: "CUS-001 Lahore" },
      { value: "customer-2", label: "Bismillah Stores", keywords: "CUS-002 Karachi" },
    ];

    expect(filterSelectOptions(options, "  cus-002 ")).toEqual([options[1]]);
    expect(filterSelectOptions(options, "AL NOOR")).toEqual([options[0]]);
    expect(filterSelectOptions(options, "not present")).toEqual([]);
    expect(filterSelectOptions(options, " ")).toEqual(options);
  });

  it("moves the active option predictably and wraps nonempty lists", () => {
    // Production defect caught: keyboard users can lose the active option at list boundaries.
    expect(nextActiveOptionIndex(-1, "next", 3)).toBe(0);
    expect(nextActiveOptionIndex(2, "next", 3)).toBe(0);
    expect(nextActiveOptionIndex(0, "previous", 3)).toBe(2);
    expect(nextActiveOptionIndex(1, "first", 3)).toBe(0);
    expect(nextActiveOptionIndex(1, "last", 3)).toBe(2);
    expect(nextActiveOptionIndex(0, "next", 0)).toBe(-1);
  });

  it("admits only one submission until the active request is released", () => {
    // Production defect caught: rapid click/Enter can dispatch duplicate create actions.
    const guard = createSingleFlightGuard();

    expect(guard.enter()).toBe(true);
    expect(guard.active()).toBe(true);
    expect(guard.enter()).toBe(false);
    guard.leave();
    expect(guard.active()).toBe(false);
    expect(guard.enter()).toBe(true);
  });

  it("keeps remaining line identities stable when a removed row is replaced", () => {
    // Production defect caught: index keys can move typed values to the wrong ERP line after removal.
    const lines = [createLineKey(), createLineKey(), createLineKey()];
    const retained = [lines[0], lines[2]];
    const next = [...retained, createLineKey()];

    expect(new Set(next).size).toBe(3);
    expect(next.slice(0, 2)).toEqual(retained);
  });
});
