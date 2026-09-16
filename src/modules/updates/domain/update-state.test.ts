import { describe, expect, it } from "vitest";

import {
  advanceStage,
  canonicalizeUpdateStateData,
  createInitialUpdateState,
  decideRecoveryAction,
  isTerminal,
  isUpdateStage,
  type UpdateStateData,
} from "./update-state";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function baseState(overrides: Partial<UpdateStateData> = {}): UpdateStateData {
  return {
    ...createInitialUpdateState({
      updateId: "upd-1",
      packageId: "pkg-1",
      fromVersion: "0.1.0",
      toVersion: "0.2.0",
      now: NOW,
    }),
    ...overrides,
  };
}

describe("createInitialUpdateState", () => {
  it("starts at PackageVerified with no side effects recorded yet", () => {
    const state = baseState();
    expect(state.stage).toBe("PackageVerified");
    expect(state.backupId).toBeNull();
    expect(state.migrationCompleted).toBe(false);
    expect(state.activationCompleted).toBe(false);
    expect(state.healthResult).toBe("pending");
    expect(state.rollbackResult).toBe("not-attempted");
    expect(state.previousRelease).toBe("0.1.0");
    expect(state.targetRelease).toBe("0.2.0");
  });
});

describe("isUpdateStage", () => {
  it("accepts every declared stage and rejects garbage", () => {
    expect(isUpdateStage("PackageVerified")).toBe(true);
    expect(isUpdateStage("Complete")).toBe(true);
    expect(isUpdateStage("NotAStage")).toBe(false);
    expect(isUpdateStage(123)).toBe(false);
  });
});

describe("isTerminal", () => {
  it("treats Complete/AbortedBackupFailed/RolledBack/StoppedForRecovery as terminal", () => {
    expect(isTerminal(baseState({ stage: "Complete" }))).toBe(true);
    expect(isTerminal(baseState({ stage: "AbortedBackupFailed" }))).toBe(true);
    expect(isTerminal(baseState({ stage: "RolledBack" }))).toBe(true);
    expect(isTerminal(baseState({ stage: "StoppedForRecovery" }))).toBe(true);
    expect(isTerminal(baseState({ stage: "MigrationApplied" }))).toBe(false);
  });
});

describe("advanceStage", () => {
  it("updates the stage and updatedAt, applying an optional patch", () => {
    const state = baseState();
    const later = new Date("2026-01-01T01:00:00.000Z");
    const next = advanceStage(state, "BackupVerified", later, { backupId: "bkp-1" });
    expect(next.stage).toBe("BackupVerified");
    expect(next.backupId).toBe("bkp-1");
    expect(next.updatedAt).toBe(later.toISOString());
    expect(next.createdAt).toBe(state.createdAt);
  });
});

describe("canonicalizeUpdateStateData", () => {
  it("is stable regardless of object construction and changes when a field changes", () => {
    const a = baseState();
    expect(canonicalizeUpdateStateData(a)).toBe(canonicalizeUpdateStateData({ ...a }));
    expect(canonicalizeUpdateStateData(a)).not.toBe(
      canonicalizeUpdateStateData(baseState({ stage: "BackupVerified" })),
    );
  });
});

describe("decideRecoveryAction", () => {
  it("retries from scratch when interrupted before or during staging", () => {
    expect(decideRecoveryAction(baseState({ stage: "PackageVerified" }), true)).toEqual({
      kind: "retry-from-scratch",
    });
    expect(decideRecoveryAction(baseState({ stage: "PayloadStaged" }), true)).toEqual({
      kind: "retry-from-scratch",
    });
  });

  it("resumes stop-confirmation when the runtime was stopped but not confirmed", () => {
    expect(decideRecoveryAction(baseState({ stage: "RuntimeStopped" }), true)).toEqual({
      kind: "resume-stop-confirm",
    });
  });

  it("resumes the backup gate once stop is confirmed", () => {
    expect(decideRecoveryAction(baseState({ stage: "RuntimeStopConfirmed" }), true)).toEqual({
      kind: "resume-backup",
    });
  });

  it("resumes migration once backup is verified (migrate deploy is idempotent)", () => {
    expect(decideRecoveryAction(baseState({ stage: "BackupVerified" }), true)).toEqual({
      kind: "resume-migration",
    });
  });

  it("resumes activation once migration is applied (pointer rename is idempotent)", () => {
    expect(decideRecoveryAction(baseState({ stage: "MigrationApplied" }), true)).toEqual({
      kind: "resume-activation",
    });
  });

  it("resumes start/health once the release is activated or the task was started", () => {
    expect(decideRecoveryAction(baseState({ stage: "ReleaseActivated" }), true)).toEqual({
      kind: "resume-start-health",
    });
    expect(decideRecoveryAction(baseState({ stage: "TaskStarted" }), true)).toEqual({
      kind: "resume-start-health",
    });
  });

  it("is a no-op once a terminal stage is reached", () => {
    for (const stage of [
      "Complete",
      "AbortedBackupFailed",
      "RolledBack",
      "StoppedForRecovery",
    ] as const) {
      expect(decideRecoveryAction(baseState({ stage }), true)).toEqual({ kind: "none" });
    }
    expect(decideRecoveryAction(baseState({ stage: "HealthVerified" }), true)).toEqual({
      kind: "none",
    });
  });
});
