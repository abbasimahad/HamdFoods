import { z } from "zod";

export class UpdateManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpdateManifestError";
  }
}

const manifestFileEntrySchema = z
  .object({
    path: z.string().trim().min(1).max(500),
    sha256: z
      .string()
      .trim()
      .regex(/^[a-f0-9]{64}$/),
    size: z.number().int().min(0),
  })
  .strict();

export type UpdateManifestFileEntry = z.infer<typeof manifestFileEntrySchema>;

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

const updateManifestSchema = z
  .object({
    manifestVersion: z.literal(1),
    keyId: z.string().trim().min(1).max(100),
    fromVersion: z.string().regex(VERSION_PATTERN),
    toVersion: z.string().regex(VERSION_PATTERN),
    minimumInstallerSchemaVersion: z.number().int().min(1),
    nodeRuntimeIncluded: z.boolean(),
    requiredNodeVersion: z.string().trim().min(1).max(30),
    previousVersionCompatibleWithNewSchema: z.boolean(),
    issuedAt: z.iso.datetime(),
    releaseNotesSummary: z.string().trim().max(2000),
    files: z.array(manifestFileEntrySchema).min(1).max(20000),
  })
  .strict();

export type UpdateManifest = z.infer<typeof updateManifestSchema>;

export function parseUpdateManifest(value: unknown): UpdateManifest {
  const result = updateManifestSchema.safeParse(value);
  if (!result.success) throw new UpdateManifestError("Update manifest is invalid.");
  if (result.data.fromVersion === result.data.toVersion) {
    throw new UpdateManifestError("An update's toVersion must differ from its fromVersion.");
  }
  const pathIssues = findManifestPathIssues(result.data.files);
  if (pathIssues.length > 0) {
    throw new UpdateManifestError(`Update manifest file list is unsafe: ${pathIssues[0]}`);
  }
  return result.data;
}

/**
 * Deterministic serialization used as the exact byte sequence the vendor
 * signs and the runtime re-verifies. Field order is fixed; the files array
 * is sorted by path so the signature is reproducible regardless of how the
 * manifest object was constructed or iterated.
 */
export function canonicalizeUpdateManifest(manifest: UpdateManifest): string {
  const sortedFiles = [...manifest.files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => ({ path: file.path, sha256: file.sha256, size: file.size }));
  return JSON.stringify({
    manifestVersion: manifest.manifestVersion,
    keyId: manifest.keyId,
    fromVersion: manifest.fromVersion,
    toVersion: manifest.toVersion,
    minimumInstallerSchemaVersion: manifest.minimumInstallerSchemaVersion,
    nodeRuntimeIncluded: manifest.nodeRuntimeIncluded,
    requiredNodeVersion: manifest.requiredNodeVersion,
    previousVersionCompatibleWithNewSchema: manifest.previousVersionCompatibleWithNewSchema,
    issuedAt: manifest.issuedAt,
    releaseNotesSummary: manifest.releaseNotesSummary,
    files: sortedFiles,
  });
}

/**
 * Secure-extraction path rules (Phase 34 design, Section 2). Pure and
 * side-effect-free so it can be exercised identically from the manifest
 * parser (reject an unsafe manifest outright) and from the extraction
 * pipeline (reject any archive entry not exactly matching a safe,
 * manifest-declared path).
 */
export function findManifestPathIssues(files: readonly { path: string }[]): string[] {
  const issues: string[] = [];
  const seenNormalized = new Map<string, string>();
  for (const file of files) {
    if (!isSafeManifestPath(file.path)) {
      issues.push(`unsafe path: ${file.path}`);
      continue;
    }
    const normalized = file.path.toLowerCase();
    const existing = seenNormalized.get(normalized);
    if (existing && existing !== file.path) {
      issues.push(`case-colliding duplicate paths: ${existing} vs ${file.path}`);
    } else if (existing === file.path) {
      issues.push(`duplicate path: ${file.path}`);
    } else {
      seenNormalized.set(normalized, file.path);
    }
  }
  return issues;
}

export function isSafeManifestPath(candidate: string): boolean {
  if (!candidate || candidate.length > 500) return false;
  if (candidate.startsWith("/") || candidate.startsWith("\\")) return false;
  if (/^[A-Za-z]:[/\\]/.test(candidate)) return false;
  if (candidate.startsWith("\\\\")) return false;
  if (!candidate.startsWith("payload/")) return false;
  const segments = candidate.split(/[/\\]/);
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".."))
    return false;
  if (/[\0]/.test(candidate)) return false;
  return true;
}
