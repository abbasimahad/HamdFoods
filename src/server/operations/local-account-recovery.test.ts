import { describe, expect, it } from "vitest";

import { isAdministratorHighIntegrity } from "./local-account-recovery";

describe("local account recovery host boundary", () => {
  it("accepts only an Administrators membership with a high-integrity SID", () => {
    // Defect caught: an unelevated local process could invoke credential recovery.
    const elevated = `BUILTIN\\Administrators S-1-5-32-544\nHigh Mandatory Level S-1-16-12288`;
    const unelevated = `BUILTIN\\Administrators S-1-5-32-544\nMedium Mandatory Level S-1-16-8192`;
    const highNonAdmin = `Users S-1-5-32-545\nHigh Mandatory Level S-1-16-12288`;

    expect(isAdministratorHighIntegrity(elevated)).toBe(true);
    expect(isAdministratorHighIntegrity(unelevated)).toBe(false);
    expect(isAdministratorHighIntegrity(highNonAdmin)).toBe(false);
  });
});
