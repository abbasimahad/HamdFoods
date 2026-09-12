import { afterEach, describe, expect, it, vi } from "vitest";

describe("Playwright process environment", () => {
  const originalNoColor = process.env.NO_COLOR;

  afterEach(() => {
    if (originalNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = originalNoColor;
  });

  it("removes inherited NO_COLOR before Playwright forces child-process color", async () => {
    process.env.NO_COLOR = "1";
    vi.resetModules();

    await import("../../playwright.config");

    expect(process.env.NO_COLOR).toBeUndefined();
  });
});
