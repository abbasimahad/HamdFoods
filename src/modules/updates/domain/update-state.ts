export const UPDATE_STAGES = [
  "PackageVerified",
  "PayloadStaged",
  "RuntimeStopped",
  "RuntimeStopConfirmed",
  "BackupVerified",
  "MigrationApplied",
  "ReleaseActivated",
  "TaskStarted",
  "HealthVerified",
  "Complete",
  "AbortedBackupFailed",
  "RolledBack",
  "StoppedForRecovery",
] as const;
export type UpdateStage = (typeof UPDATE_STAGES)[number];

/** Stages beyond which an update is finished, one way or another. */
export const TERMINAL_UPDATE_STAGES: readonly UpdateStage[] = [
  "Complete",
  "AbortedBackupFailed",
  "RolledBack",
  "StoppedForRecovery",
];

export type RollbackResult = "not-attempted" | "succeeded" | "failed" | "prohibited";
export type HealthResult = "pending" | "pass" | "fail";

export type UpdateStateData = {
  schemaVersion: 1;
  updateId: string;
  packageId: string;
  fromVersion: string;
  toVersion: string;
  stage: UpdateStage;
  backupId: string | null;
  previousRelease: string;
  targetRelease: string;
  migrationCompleted: boolean;
  migrationCompletedAt: string | null;
  activationCompleted: boolean;
  activationCompletedAt: string | null;
  healthResult: HealthResult;
  healthCheckedAt: string | null;
  rollbackResult: RollbackResult;
  rollbackAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function isUpdateStage(value: unknown): value is UpdateStage {
  return typeof value === "string" && (UPDATE_STAGES as readonly string[]).includes(value);
}

export function createInitialUpdateState(input: {
  updateId: string;
  packageId: string;
  fromVersion: string;
  toVersion: string;
  now: Date;
}): UpdateStateData {
  const timestamp = input.now.toISOString();
  return {
    schemaVersion: 1,
    updateId: input.updateId,
    packageId: input.packageId,
    fromVersion: input.fromVersion,
    toVersion: input.toVersion,
    stage: "PackageVerified",
    backupId: null,
    previousRelease: input.fromVersion,
    targetRelease: input.toVersion,
    migrationCompleted: false,
    migrationCompletedAt: null,
    activationCompleted: false,
    activationCompletedAt: null,
    healthResult: "pending",
    healthCheckedAt: null,
    rollbackResult: "not-attempted",
    rollbackAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function isTerminal(state: UpdateStateData): boolean {
  return TERMINAL_UPDATE_STAGES.includes(state.stage);
}

/**
 * Advances state to a new stage, always refreshing updatedAt. Pure and
 * side-effect-free -- the caller is responsible for persisting the result
 * via update-state-store.ts before performing the corresponding real
 * action, so a crash between "decide next stage" and "act" always resumes
 * from a state that has not yet claimed the action succeeded.
 */
export function advanceStage(
  state: UpdateStateData,
  stage: UpdateStage,
  now: Date,
  patch: Partial<UpdateStateData> = {},
): UpdateStateData {
  return { ...state, ...patch, stage, updatedAt: now.toISOString() };
}

export function canonicalizeUpdateStateData(data: UpdateStateData): string {
  return JSON.stringify({
    schemaVersion: data.schemaVersion,
    updateId: data.updateId,
    packageId: data.packageId,
    fromVersion: data.fromVersion,
    toVersion: data.toVersion,
    stage: data.stage,
    backupId: data.backupId,
    previousRelease: data.previousRelease,
    targetRelease: data.targetRelease,
    migrationCompleted: data.migrationCompleted,
    migrationCompletedAt: data.migrationCompletedAt,
    activationCompleted: data.activationCompleted,
    activationCompletedAt: data.activationCompletedAt,
    healthResult: data.healthResult,
    healthCheckedAt: data.healthCheckedAt,
    rollbackResult: data.rollbackResult,
    rollbackAt: data.rollbackAt,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  });
}

/**
 * Given the on-disk state after an interruption, what should happen next.
 * Pure decision function -- Phase 34 design Section 8's recovery table,
 * encoded so it is unit-testable without any OS/process interaction.
 */
export type RecoveryAction =
  | { kind: "retry-from-scratch" } // before/during staging: discard and restart
  | { kind: "resume-stop-confirm" }
  | { kind: "resume-backup" }
  | { kind: "resume-migration" } // migrate deploy is naturally idempotent
  | { kind: "resume-activation" } // pointer rename is naturally idempotent
  | { kind: "resume-start-health" }
  | { kind: "evaluate-rollback"; allowed: boolean }
  | { kind: "none" }; // already terminal

export function decideRecoveryAction(
  state: UpdateStateData,
  previousVersionCompatibleWithNewSchema: boolean,
): RecoveryAction {
  switch (state.stage) {
    case "PackageVerified":
    case "PayloadStaged":
      return { kind: "retry-from-scratch" };
    case "RuntimeStopped":
      return { kind: "resume-stop-confirm" };
    case "RuntimeStopConfirmed":
      return { kind: "resume-backup" };
    case "BackupVerified":
      return { kind: "resume-migration" };
    case "MigrationApplied":
      return { kind: "resume-activation" };
    case "ReleaseActivated":
      return { kind: "resume-start-health" };
    case "TaskStarted":
      return { kind: "resume-start-health" };
    case "HealthVerified":
      return { kind: "none" };
    case "Complete":
    case "AbortedBackupFailed":
    case "RolledBack":
    case "StoppedForRecovery":
      return { kind: "none" };
    default:
      return { kind: "evaluate-rollback", allowed: previousVersionCompatibleWithNewSchema };
  }
}
