import path from "node:path";

import {
  createInitialLicenseStateData,
  evaluateLicenseState,
  isMutationAllowed,
  type LicenseState,
} from "@/modules/licensing/domain/license";
import { buildActivationRequest, writeActivationRequestFile } from "./activation-request";
import { resolveDpapiScriptPath } from "./dpapi";
import {
  importLicenseFile,
  readLicenseFileVerdict,
  resolveLicenseFilePaths,
} from "./license-file-store";
import {
  readLicenseState,
  resetLicenseState,
  resolveLicenseStateStorePaths,
  writeLicenseState,
} from "./license-state-store";
import { computeMachineFingerprint, resolveFingerprintScriptPath } from "./machine-fingerprint";
import { TRUSTED_LICENSE_PUBLIC_KEYS } from "./public-keys";

export type LicenseStatus = {
  state: LicenseState;
  mutationAllowed: boolean;
  daysRemaining: number | null;
  customer: string | null;
  expiresAt: string | null;
  maskedFingerprint: string | null;
  computedAt: string;
};

const REFRESH_INTERVAL_MS = 15 * 60 * 1000;
let cached: LicenseStatus | null = null;
let cachedAt = 0;

function dataRootEnv(): string | undefined {
  return process.env.HAMDFOODS_DATA_ROOT;
}

/**
 * Resolves where license.lic / license-state.json live. A real customer
 * installation always sets HAMDFOODS_DATA_ROOT (see Run-HamdFoodsERP.ps1)
 * to C:\ProgramData\HamdFoodsERP. When it is unset -- local
 * `pnpm production:*` testing from a checkout -- a repo-local, gitignored
 * fallback directory is used instead so local production verification
 * never touches real ProgramData.
 */
export function resolveLicenseDataRoot(): string {
  return dataRootEnv() ?? path.join(process.cwd(), ".license-runtime");
}

function maskFingerprint(fingerprint: string | null): string | null {
  if (!fingerprint) return null;
  return `\u2026${fingerprint.slice(-6)}`;
}

function tamperedFallback(): LicenseStatus {
  return {
    state: "TAMPERED_STATE",
    mutationAllowed: false,
    daysRemaining: null,
    customer: null,
    expiresAt: null,
    maskedFingerprint: null,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Pure(ish) orchestration against a given data root: reads local state and
 * the license file, computes the machine fingerprint, evaluates the state
 * machine, and persists the resulting grace/rollback anchors. Exposed
 * separately from getLicenseStatus() so it can be exercised directly in
 * tests against a temporary directory without touching real ProgramData or
 * process-level caching.
 */
export function computeLicenseStatus(
  dataRoot: string,
  now: Date = new Date(),
  trustedKeys: Readonly<Record<string, string>> = TRUSTED_LICENSE_PUBLIC_KEYS,
): LicenseStatus {
  const dpapiScript = resolveDpapiScriptPath({
    repositoryRoot: process.cwd(),
    dataRoot: dataRootEnv(),
  });
  const fingerprintScript = resolveFingerprintScriptPath({
    repositoryRoot: process.cwd(),
    dataRoot: dataRootEnv(),
  });

  const statePaths = resolveLicenseStateStorePaths(dataRoot);
  const stateResult = readLicenseState(statePaths, dpapiScript);
  const stateReadFailed = stateResult.kind === "corrupted";
  let stateData = stateResult.kind === "ok" ? stateResult.data : null;
  if (stateResult.kind === "absent") {
    stateData = createInitialLicenseStateData(now);
    writeLicenseState(statePaths, dpapiScript, stateData);
  }

  const filePaths = resolveLicenseFilePaths(dataRoot);
  const fileVerdict = readLicenseFileVerdict(filePaths, trustedKeys);

  let currentFingerprint = "";
  try {
    currentFingerprint = computeMachineFingerprint(fingerprintScript, dataRoot);
  } catch {
    currentFingerprint = "";
  }

  const evaluation = evaluateLicenseState({
    now,
    stateReadFailed,
    stateData,
    fileVerdict,
    currentFingerprint,
  });

  if (evaluation.nextStateData && !stateReadFailed) {
    try {
      writeLicenseState(statePaths, dpapiScript, evaluation.nextStateData);
    } catch {
      // Best-effort persistence: a write failure here does not invalidate
      // the state just evaluated for this call.
    }
  }

  return {
    state: evaluation.state,
    mutationAllowed: isMutationAllowed(evaluation.state),
    daysRemaining: evaluation.daysRemaining,
    customer: evaluation.payload?.customer ?? null,
    expiresAt: evaluation.payload?.expiresAt ?? null,
    maskedFingerprint: maskFingerprint(
      currentFingerprint || evaluation.payload?.machineFingerprint || null,
    ),
    computedAt: now.toISOString(),
  };
}

function unrestrictedStatus(): LicenseStatus {
  return {
    state: "VALID",
    mutationAllowed: true,
    daysRemaining: null,
    customer: null,
    expiresAt: null,
    maskedFingerprint: null,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Licensing is enforced only for real Windows production installations
 * (APP_ENV=production on win32, matching the rest of the native production
 * model, see src/server/env.ts). Development, test, CI, and any
 * non-Windows environment always evaluate as unrestricted so the existing
 * test suite and developer workflow are unaffected. APP_ENV is read
 * directly from process.env (not the fully-validated serverEnv singleton)
 * so this module stays independently unit-testable, matching the
 * explicit-input convention already used by parseNativeProductionEnv.
 */
export function getLicenseStatus(options: { forceRefresh?: boolean } = {}): LicenseStatus {
  if (process.env.APP_ENV !== "production" || process.platform !== "win32")
    return unrestrictedStatus();

  if (options.forceRefresh || !cached || Date.now() - cachedAt > REFRESH_INTERVAL_MS) {
    let computed: LicenseStatus;
    try {
      computed = computeLicenseStatus(resolveLicenseDataRoot());
    } catch {
      computed = tamperedFallback();
    }
    cached = computed;
    cachedAt = Date.now();
    return computed;
  }
  return cached;
}

export function refreshLicenseStatus(): LicenseStatus {
  return getLicenseStatus({ forceRefresh: true });
}

export function generateActivationRequestForCurrentMachine(): string {
  const dataRoot = resolveLicenseDataRoot();
  const fingerprintScript = resolveFingerprintScriptPath({
    repositoryRoot: process.cwd(),
    dataRoot: dataRootEnv(),
  });
  const fingerprint = computeMachineFingerprint(fingerprintScript, dataRoot);
  const request = buildActivationRequest(fingerprint, new Date());
  const filePaths = resolveLicenseFilePaths(dataRoot);
  return writeActivationRequestFile(filePaths, request);
}

export function importLicenseFileContent(content: string): void {
  const dataRoot = resolveLicenseDataRoot();
  const filePaths = resolveLicenseFilePaths(dataRoot);
  importLicenseFile(filePaths, content);
  refreshLicenseStatus();
}

export function resetCorruptedLocalState(): void {
  const dataRoot = resolveLicenseDataRoot();
  const statePaths = resolveLicenseStateStorePaths(dataRoot);
  resetLicenseState(statePaths);
  refreshLicenseStatus();
}
