import { z } from "zod";

export const LICENSE_STATES = [
  "SETUP_GRACE",
  "VALID",
  "EXPIRY_GRACE",
  "EXPIRED",
  "MACHINE_MISMATCH",
  "INVALID_SIGNATURE",
  "TAMPERED_STATE",
  "CLOCK_ROLLBACK",
] as const;
export type LicenseState = (typeof LICENSE_STATES)[number];

export const SETUP_GRACE_DAYS = 14;
export const EXPIRY_GRACE_DAYS = 30;
export const CLOCK_ROLLBACK_TOLERANCE_MS = 15 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export class LicenseDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LicenseDomainError";
  }
}

const licensePayloadSchema = z
  .object({
    payloadVersion: z.literal(1),
    keyId: z.string().trim().min(1).max(100),
    licenseId: z.string().trim().min(1).max(100),
    customer: z.string().trim().min(1).max(200),
    issuedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime().nullable(),
    machineFingerprint: z.string().trim().min(16).max(200),
  })
  .strict();

export type LicensePayload = z.infer<typeof licensePayloadSchema>;

export function parseLicensePayload(value: unknown): LicensePayload {
  const result = licensePayloadSchema.safeParse(value);
  if (!result.success) throw new LicenseDomainError("License payload is invalid.");
  return result.data;
}

/**
 * Deterministic serialization used as the exact byte sequence the vendor
 * signs and the runtime re-verifies. Field order is fixed, not derived from
 * object insertion order, so re-serialization is always byte-identical.
 */
export function canonicalizeLicensePayload(payload: LicensePayload): string {
  return JSON.stringify({
    payloadVersion: payload.payloadVersion,
    keyId: payload.keyId,
    licenseId: payload.licenseId,
    customer: payload.customer,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    machineFingerprint: payload.machineFingerprint,
  });
}

export type LicenseStateData = {
  schemaVersion: 1;
  setupGraceAnchor: string;
  expiryGraceAnchor: string | null;
  lastObservedTime: string;
};

export function canonicalizeLicenseStateData(data: LicenseStateData): string {
  return JSON.stringify({
    schemaVersion: data.schemaVersion,
    setupGraceAnchor: data.setupGraceAnchor,
    expiryGraceAnchor: data.expiryGraceAnchor,
    lastObservedTime: data.lastObservedTime,
  });
}

export function createInitialLicenseStateData(now: Date): LicenseStateData {
  return {
    schemaVersion: 1,
    setupGraceAnchor: now.toISOString(),
    expiryGraceAnchor: null,
    lastObservedTime: now.toISOString(),
  };
}

export type LicenseFileVerdict =
  { kind: "absent" } | { kind: "invalid-signature" } | { kind: "valid"; payload: LicensePayload };

export type EvaluateLicenseStateInput = {
  now: Date;
  stateReadFailed: boolean;
  stateData: LicenseStateData | null;
  fileVerdict: LicenseFileVerdict;
  currentFingerprint: string;
};

export type LicenseEvaluation = {
  state: LicenseState;
  daysRemaining: number | null;
  payload: LicensePayload | null;
  nextStateData: LicenseStateData | null;
};

export function evaluateLicenseState(input: EvaluateLicenseStateInput): LicenseEvaluation {
  const { now } = input;

  if (input.stateReadFailed || !input.stateData) {
    return { state: "TAMPERED_STATE", daysRemaining: null, payload: null, nextStateData: null };
  }

  const stateData = input.stateData;
  const lastObserved = new Date(stateData.lastObservedTime);
  const rollback = now.getTime() < lastObserved.getTime() - CLOCK_ROLLBACK_TOLERANCE_MS;
  if (rollback) {
    return { state: "CLOCK_ROLLBACK", daysRemaining: null, payload: null, nextStateData: null };
  }

  const advancedLastObserved =
    now.getTime() > lastObserved.getTime() ? now.toISOString() : stateData.lastObservedTime;

  if (input.fileVerdict.kind === "absent") {
    const elapsedDays = daysBetween(new Date(stateData.setupGraceAnchor), now);
    if (elapsedDays <= SETUP_GRACE_DAYS) {
      return {
        state: "SETUP_GRACE",
        daysRemaining: SETUP_GRACE_DAYS - elapsedDays,
        payload: null,
        nextStateData: { ...stateData, lastObservedTime: advancedLastObserved },
      };
    }
    return {
      state: "EXPIRED",
      daysRemaining: 0,
      payload: null,
      nextStateData: { ...stateData, lastObservedTime: advancedLastObserved },
    };
  }

  if (input.fileVerdict.kind === "invalid-signature") {
    return {
      state: "INVALID_SIGNATURE",
      daysRemaining: null,
      payload: null,
      nextStateData: { ...stateData, lastObservedTime: advancedLastObserved },
    };
  }

  const payload = input.fileVerdict.payload;
  if (payload.machineFingerprint !== input.currentFingerprint) {
    return {
      state: "MACHINE_MISMATCH",
      daysRemaining: null,
      payload,
      nextStateData: { ...stateData, lastObservedTime: advancedLastObserved },
    };
  }

  const expiresAt = payload.expiresAt ? new Date(payload.expiresAt) : null;
  if (!expiresAt || now.getTime() <= expiresAt.getTime()) {
    return {
      state: "VALID",
      daysRemaining: null,
      payload,
      nextStateData: {
        ...stateData,
        expiryGraceAnchor: null,
        lastObservedTime: advancedLastObserved,
      },
    };
  }

  const expiryGraceAnchor = stateData.expiryGraceAnchor
    ? new Date(stateData.expiryGraceAnchor)
    : expiresAt;
  const elapsedGraceDays = daysBetween(expiryGraceAnchor, now);
  const nextStateData: LicenseStateData = {
    ...stateData,
    expiryGraceAnchor: stateData.expiryGraceAnchor ?? expiresAt.toISOString(),
    lastObservedTime: advancedLastObserved,
  };

  if (elapsedGraceDays <= EXPIRY_GRACE_DAYS) {
    return {
      state: "EXPIRY_GRACE",
      daysRemaining: EXPIRY_GRACE_DAYS - elapsedGraceDays,
      payload,
      nextStateData,
    };
  }
  return { state: "EXPIRED", daysRemaining: 0, payload, nextStateData };
}

export function isMutationAllowed(state: LicenseState): boolean {
  return state === "SETUP_GRACE" || state === "VALID" || state === "EXPIRY_GRACE";
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));
}
