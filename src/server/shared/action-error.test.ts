import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { safeActionErrorMessage } from "./action-error";

class KnownDomainError extends Error {}
class OtherDomainError extends Error {}

describe("safeActionErrorMessage", () => {
  it("returns the error's own message when it is one of the known types", () => {
    const error = new KnownDomainError("A specific, safe validation message.");
    expect(safeActionErrorMessage(error, "generic fallback", KnownDomainError)).toBe(
      "A specific, safe validation message.",
    );
  });

  it("returns the generic fallback for a plain Error, even though it is technically `instanceof Error`", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("Unique constraint failed on the fields: (`code`)");
    expect(safeActionErrorMessage(error, "generic fallback", KnownDomainError)).toBe(
      "generic fallback",
    );
    expect(spy).toHaveBeenCalledWith("generic fallback", error);
    spy.mockRestore();
  });

  it("returns the generic fallback for a non-Error thrown value", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(safeActionErrorMessage("boom", "generic fallback", KnownDomainError)).toBe(
      "generic fallback",
    );
    spy.mockRestore();
  });

  it("checks every known type provided, not just the first", () => {
    const error = new OtherDomainError("Also a safe, specific message.");
    expect(
      safeActionErrorMessage(error, "generic fallback", KnownDomainError, OtherDomainError),
    ).toBe("Also a safe, specific message.");
  });
});
