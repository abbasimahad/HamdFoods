import { describe, expect, it } from "vitest";

import { parseBootstrapEnv } from "./bootstrap-env";

describe("bootstrap environment", () => {
  it("normalizes identity fields without changing the password", () => {
    // Defect caught: reruns could miss the same email or silently alter a credential.
    expect(
      parseBootstrapEnv({
        BOOTSTRAP_ADMIN_NAME: "  Factory Owner  ",
        BOOTSTRAP_ADMIN_EMAIL: "  OWNER@EXAMPLE.COM ",
        BOOTSTRAP_ADMIN_PASSWORD: " password with spaces ",
      }),
    ).toEqual({
      name: "Factory Owner",
      email: "owner@example.com",
      password: " password with spaces ",
    });
  });

  it("names a missing bootstrap password", () => {
    // Defect caught: the command could fail with an unactionable or secret-revealing error.
    expect(() =>
      parseBootstrapEnv({
        BOOTSTRAP_ADMIN_NAME: "Factory Owner",
        BOOTSTRAP_ADMIN_EMAIL: "owner@example.com",
      }),
    ).toThrowError(/BOOTSTRAP_ADMIN_PASSWORD/);
  });
});
