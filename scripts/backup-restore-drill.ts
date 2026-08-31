import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  applyRetention,
  assertSafeRestoreTarget,
  createBackup,
  databaseExists,
  DatabaseBackupError,
  removeSafeRestoreDatabase,
  restoreBackup,
  verifyBackupArtifact,
} from "../src/server/operations/database-backup";
import {
  PHASE27_TEST_DATABASE_URL,
  PHASE28_RESTORE_DATABASE_URL,
} from "../src/test/test-environment";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const backupDirectory = path.join(repositoryRoot, ".test-data", "phase28-backups");
const sentinelPath = path.join(repositoryRoot, ".test-data", "phase28-retention-sentinel.txt");
const safety = {
  sourceDatabaseUrl: PHASE27_TEST_DATABASE_URL,
  sourceDatabaseName: "factory_erp_test",
  ...(process.env.DATABASE_URL && process.env.DATABASE_URL !== PHASE27_TEST_DATABASE_URL
    ? { developmentDatabaseUrl: process.env.DATABASE_URL }
    : {}),
};

if (process.env.TEST_DATABASE_URL !== PHASE27_TEST_DATABASE_URL)
  throw new DatabaseBackupError("Phase 28 drill requires the fixed Phase 27 source database.");
if (process.env.RESTORE_DATABASE_URL !== PHASE28_RESTORE_DATABASE_URL)
  throw new DatabaseBackupError("Phase 28 drill requires the fixed isolated restore database.");

mkdirSync(backupDirectory, { recursive: true });
await removeSafeRestoreDatabase(PHASE28_RESTORE_DATABASE_URL, safety);

const unsafeTargets = [
  PHASE27_TEST_DATABASE_URL,
  "postgresql://postgres@127.0.0.1:55433/postgres",
  "postgresql://postgres@127.0.0.1:55433/factory_erp",
  "postgresql://postgres@127.0.0.1:55433/factory_erp_restore",
  "postgresql://postgres@127.0.0.1:55433/factory_prod_restore_test",
];
for (const target of unsafeTargets) {
  let rejected = false;
  try {
    assertSafeRestoreTarget(target, safety);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new DatabaseBackupError(`Unsafe restore target was accepted: ${target}`);
}

const backup = await createBackup({
  databaseUrl: PHASE27_TEST_DATABASE_URL,
  backupDirectory,
  retention: false,
});
const verified = await verifyBackupArtifact(backupDirectory, backup.manifest.backupId);
const corruptId = `${backup.manifest.backupId}-checksum-test`;
const corrupt = {
  dumpPath: path.join(backupDirectory, `${corruptId}.dump`),
  manifestPath: path.join(backupDirectory, `${corruptId}.manifest.json`),
};
copyFileSync(verified.dumpPath, corrupt.dumpPath);
writeFileSync(
  corrupt.manifestPath,
  `${JSON.stringify(
    {
      ...backup.manifest,
      backupId: corruptId,
      dumpFilename: `${corruptId}.dump`,
      sha256: "0".repeat(64),
    },
    null,
    2,
  )}\n`,
  "utf8",
);
let checksumRejected = false;
try {
  await restoreBackup({
    backupIdentifier: corruptId,
    backupDirectory,
    targetDatabaseUrl: PHASE28_RESTORE_DATABASE_URL,
    sourceDatabaseUrl: PHASE27_TEST_DATABASE_URL,
  });
} catch (error) {
  checksumRejected =
    error instanceof DatabaseBackupError && error.message.includes("SHA-256 checksum");
}
if (!checksumRejected)
  throw new DatabaseBackupError("Corrupt backup was not rejected by checksum verification.");
if (await databaseExists(PHASE28_RESTORE_DATABASE_URL))
  throw new DatabaseBackupError("Checksum rejection occurred after destructive restore work.");

const oldId = `${backup.manifest.backupId}-retention-test`;
const oldDumpFilename = `${oldId}.dump`;
const oldManifestPath = path.join(backupDirectory, `${oldId}.manifest.json`);
const oldDumpPath = path.join(backupDirectory, oldDumpFilename);
writeFileSync(sentinelPath, "retention must not remove this file\n", "utf8");
writeFileSync(oldDumpPath, readFileSync(verified.dumpPath));
writeFileSync(
  oldManifestPath,
  `${JSON.stringify(
    {
      ...backup.manifest,
      backupId: oldId,
      dumpFilename: oldDumpFilename,
      createdAt: "2000-01-01T00:00:00.000Z",
    },
    null,
    2,
  )}\n`,
  "utf8",
);
const removed = applyRetention(backupDirectory, { keepLast: 2 }, new Date());
if (!removed.includes(oldId) || existsSync(oldDumpPath) || existsSync(oldManifestPath))
  throw new DatabaseBackupError("Retention did not remove only the eligible backup pair.");
if (!existsSync(sentinelPath))
  throw new DatabaseBackupError("Retention escaped its configured backup directory.");

const restore = await restoreBackup({
  backupIdentifier: backup.manifest.backupId,
  backupDirectory,
  targetDatabaseUrl: PHASE28_RESTORE_DATABASE_URL,
  sourceDatabaseUrl: PHASE27_TEST_DATABASE_URL,
});
const temporaryArtifacts = [corrupt.dumpPath, corrupt.manifestPath, sentinelPath];
for (const artifact of temporaryArtifacts) if (existsSync(artifact)) unlinkSync(artifact);
const atomicCompletion = !readdirSync(backupDirectory).some((name) => name.endsWith(".tmp"));
if (!atomicCompletion) throw new DatabaseBackupError("Completed backup left temporary artifacts.");

console.log(
  JSON.stringify(
    {
      backupId: backup.manifest.backupId,
      backupFormat: backup.manifest.backupFormat,
      manifest: "PASS",
      checksumVerification: "PASS",
      checksumRejection: "PASS",
      unsafeTargetRejection: "PASS",
      atomicCompletion: "PASS",
      retentionSafety: "PASS",
      restoreDatabase: restore.targetDatabaseName,
      migrations: "PASS",
      sourceVsRestored: "PASS",
      integrity: restore.integrity,
    },
    null,
    2,
  ),
);
