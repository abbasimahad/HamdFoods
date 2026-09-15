import { describe, expect, it } from "vitest";

import {
  canonicalizeLicensePayload,
  canonicalizeLicenseStateData,
  createInitialLicenseStateData,
  evaluateLicenseState,
  isMutationAllowed,
  parseLicensePayload,
  type LicensePayload,
  type LicenseStateData,
} from "./license";

const FINGERPRINT = "a".repeat(32);

function payload(overrides: Partial<LicensePayload> = {}): LicensePayload {
  return {
    payloadVersion: 1,
    keyId: "vendor-key-1",
    licenseId: "11111111-1111-1111-1111-111111111111",
    customer: "Hamd Foods",
    issuedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: null,
    machineFingerprint: FINGERPRINT,
    ...overrides,
  };
}

function stateData(overrides: Partial<LicenseStateData> = {}): LicenseStateData {
  return {
    schemaVersion: 1,
    setupGraceAnchor: "2026-01-01T00:00:00.000Z",
    expiryGraceAnchor: null,
    lastObservedTime: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("canonicalizeLicensePayload", () => {
  it("produces a fixed field order regardless of input key order", () => {
    const a = payload();
    const b = { ...a };
    expect(canonicalizeLicensePayload(a)).toBe(canonicalizeLicensePayload(b));
    expect(canonicalizeLicensePayload(a)).toBe(
      '{"payloadVersion":1,"keyId":"vendor-key-1","licenseId":"11111111-1111-1111-1111-111111111111","customer":"Hamd Foods","issuedAt":"2026-01-01T00:00:00.000Z","expiresAt":null,"machineFingerprint":"' +
        FINGERPRINT +
        '"}',
    );
  });

  it("changes when any field changes", () => {
    const base = canonicalizeLicensePayload(payload());
    const changed = canonicalizeLicensePayload(payload({ customer: "Different Customer" }));
    expect(changed).not.toBe(base);
  });
});

describe("parseLicensePayload", () => {
  it("accepts a well-formed payload", () => {
    expect(parseLicensePayload(payload())).toEqual(payload());
  });

  it("rejects an unknown payloadVersion", () => {
    expect(() => parseLicensePayload(payload({ payloadVersion: 2 as 1 }))).toThrow();
  });

  it("rejects extra unexpected fields", () => {
    expect(() => parseLicensePayload({ ...payload(), extra: "field" })).toThrow();
  });

  it("rejects a malformed machineFingerprint", () => {
    expect(() => parseLicensePayload(payload({ machineFingerprint: "short" }))).toThrow();
  });
});

describe("evaluateLicenseState", () => {
  it("reports TAMPERED_STATE when local state could not be read", () => {
    const result = evaluateLicenseState({
      now: new Date("2026-01-02T00:00:00.000Z"),
      stateReadFailed: true,
      stateData: null,
      fileVerdict: { kind: "absent" },
      currentFingerprint: FINGERPRINT,
    });
    expect(result.state).toBe("TAMPERED_STATE");
    expect(result.nextStateData).toBeNull();
  });

  it("reports TAMPERED_STATE when state data is missing even without an explicit read failure", () => {
    const result = evaluateLicenseState({
      now: new Date("2026-01-02T00:00:00.000Z"),
      stateReadFailed: false,
      stateData: null,
      fileVerdict: { kind: "absent" },
      currentFingerprint: FINGERPRINT,
    });
    expect(result.state).toBe("TAMPERED_STATE");
  });

  it("reports CLOCK_ROLLBACK when now is more than 15 minutes behind the watermark", () => {
    const result = evaluateLicenseState({
      now: new Date("2026-01-01T00:00:00.000Z"),
      stateReadFailed: false,
      stateData: stateData({ lastObservedTime: "2026-01-01T00:16:00.000Z" }),
      fileVerdict: { kind: "absent" },
      currentFingerprint: FINGERPRINT,
    });
    expect(result.state).toBe("CLOCK_ROLLBACK");
  });

  it("tolerates a clock difference within 15 minutes", () => {
    const result = evaluateLicenseState({
      now: new Date("2026-01-01T00:05:00.000Z"),
      stateReadFailed: false,
      stateData: stateData({ lastObservedTime: "2026-01-01T00:16:00.000Z" }),
      fileVerdict: { kind: "absent" },
      currentFingerprint: FINGERPRINT,
    });
    expect(result.state).not.toBe("CLOCK_ROLLBACK");
  });

  it("reports SETUP_GRACE with days remaining when no license is present within 14 days", () => {
    const result = evaluateLicenseState({
      now: new Date("2026-01-05T00:00:00.000Z"),
      stateReadFailed: false,
      stateData: stateData(),
      fileVerdict: { kind: "absent" },
      currentFingerprint: FINGERPRINT,
    });
    expect(result.state).toBe("SETUP_GRACE");
    expect(result.daysRemaining).toBe(10);
  });

  it("reports EXPIRED once the setup grace window elapses without a license", () => {
    const result = evaluateLicenseState({
      now: new Date("2026-01-16T00:00:00.000Z"),
      stateReadFailed: false,
      stateData: stateData(),
      fileVerdict: { kind: "absent" },
      currentFingerprint: FINGERPRINT,
    });
    expect(result.state).toBe("EXPIRED");
  });

  it("reports INVALID_SIGNATURE immediately with no grace", () => {
    const result = evaluateLicenseState({
      now: new Date("2026-01-01T00:00:00.000Z"),
      stateReadFailed: false,
      stateData: stateData(),
      fileVerdict: { kind: "invalid-signature" },
      currentFingerprint: FINGERPRINT,
    });
    expect(result.state).toBe("INVALID_SIGNATURE");
  });

  it("reports MACHINE_MISMATCH immediately with no grace", () => {
    const result = evaluateLicenseState({
      now: new Date("2026-01-01T00:00:00.000Z"),
      stateReadFailed: false,
      stateData: stateData(),
      fileVerdict: { kind: "valid", payload: payload({ machineFingerprint: "b".repeat(32) }) },
      currentFingerprint: FINGERPRINT,
    });
    expect(result.state).toBe("MACHINE_MISMATCH");
  });

  it("reports VALID for a matching, non-expired license", () => {
    const result = evaluateLicenseState({
      now: new Date("2026-01-01T00:00:00.000Z"),
      stateReadFailed: false,
      stateData: stateData(),
      fileVerdict: { kind: "valid", payload: payload({ expiresAt: "2026-06-01T00:00:00.000Z" }) },
      currentFingerprint: FINGERPRINT,
    });
    expect(result.state).toBe("VALID");
  });

  it("reports VALID for a license with no expiry", () => {
    const result = evaluateLicenseState({
      now: new Date("2030-01-01T00:00:00.000Z"),
      stateReadFailed: false,
      stateData: stateData(),
      fileVerdict: { kind: "valid", payload: payload({ expiresAt: null }) },
      currentFingerprint: FINGERPRINT,
    });
    expect(result.state).toBe("VALID");
  });

  it("enters EXPIRY_GRACE on first observing an expired but otherwise valid license", () => {
    const result = evaluateLicenseState({
      now: new Date("2026-01-10T00:00:00.000Z"),
      stateReadFailed: false,
      stateData: stateData(),
      fileVerdict: { kind: "valid", payload: payload({ expiresAt: "2026-01-01T00:00:00.000Z" }) },
      currentFingerprint: FINGERPRINT,
    });
    expect(result.state).toBe("EXPIRY_GRACE");
    expect(result.daysRemaining).toBe(21);
    expect(result.nextStateData?.expiryGraceAnchor).toBe("2026-01-01T00:00:00.000Z");
  });

  it("continues EXPIRY_GRACE using the persisted anchor, not re-observed expiry", () => {
    const result = evaluateLicenseState({
      now: new Date("2026-01-20T00:00:00.000Z"),
      stateReadFailed: false,
      stateData: stateData({ expiryGraceAnchor: "2026-01-01T00:00:00.000Z" }),
      fileVerdict: { kind: "valid", payload: payload({ expiresAt: "2026-01-01T00:00:00.000Z" }) },
      currentFingerprint: FINGERPRINT,
    });
    expect(result.state).toBe("EXPIRY_GRACE");
    expect(result.daysRemaining).toBe(11);
  });

  it("reports EXPIRED once the 30-day expiry grace elapses", () => {
    const result = evaluateLicenseState({
      now: new Date("2026-02-05T00:00:00.000Z"),
      stateReadFailed: false,
      stateData: stateData({ expiryGraceAnchor: "2026-01-01T00:00:00.000Z" }),
      fileVerdict: { kind: "valid", payload: payload({ expiresAt: "2026-01-01T00:00:00.000Z" }) },
      currentFingerprint: FINGERPRINT,
    });
    expect(result.state).toBe("EXPIRED");
  });

  it("clears a stale expiryGraceAnchor once a currently valid license is observed", () => {
    const result = evaluateLicenseState({
      now: new Date("2026-03-01T00:00:00.000Z"),
      stateReadFailed: false,
      stateData: stateData({ expiryGraceAnchor: "2026-01-01T00:00:00.000Z" }),
      fileVerdict: { kind: "valid", payload: payload({ expiresAt: "2026-06-01T00:00:00.000Z" }) },
      currentFingerprint: FINGERPRINT,
    });
    expect(result.state).toBe("VALID");
    expect(result.nextStateData?.expiryGraceAnchor).toBeNull();
  });
});

describe("canonicalizeLicenseStateData", () => {
  it("is stable and changes when a field changes", () => {
    const a = stateData();
    expect(canonicalizeLicenseStateData(a)).toBe(canonicalizeLicenseStateData({ ...a }));
    expect(canonicalizeLicenseStateData(a)).not.toBe(
      canonicalizeLicenseStateData(stateData({ expiryGraceAnchor: "2026-02-01T00:00:00.000Z" })),
    );
  });
});

describe("isMutationAllowed", () => {
  it("allows mutations for SETUP_GRACE, VALID, and EXPIRY_GRACE only", () => {
    expect(isMutationAllowed("SETUP_GRACE")).toBe(true);
    expect(isMutationAllowed("VALID")).toBe(true);
    expect(isMutationAllowed("EXPIRY_GRACE")).toBe(true);
    expect(isMutationAllowed("EXPIRED")).toBe(false);
    expect(isMutationAllowed("MACHINE_MISMATCH")).toBe(false);
    expect(isMutationAllowed("INVALID_SIGNATURE")).toBe(false);
    expect(isMutationAllowed("TAMPERED_STATE")).toBe(false);
    expect(isMutationAllowed("CLOCK_ROLLBACK")).toBe(false);
  });
});

describe("createInitialLicenseStateData", () => {
  it("anchors setup grace and the rollback watermark to the same instant", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const data = createInitialLicenseStateData(now);
    expect(data.setupGraceAnchor).toBe(now.toISOString());
    expect(data.lastObservedTime).toBe(now.toISOString());
    expect(data.expiryGraceAnchor).toBeNull();
  });
});
