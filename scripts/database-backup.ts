import {
  createBackup,
  DatabaseBackupError,
  listBackups,
  restoreBackup,
  verifyBackupArtifact,
} from "../src/server/operations/database-backup";

const action = process.argv[2];
const identifier = process.argv[3];
const backupDirectory = process.env.BACKUP_DIRECTORY;

try {
  if (action === "create") {
    const databaseUrl = requireEnvironment("DATABASE_URL");
    const result = await createBackup({
      databaseUrl,
      ...(backupDirectory ? { backupDirectory } : {}),
    });
    console.log(`Backup complete: ${result.dumpPath}`);
    console.log(`Manifest: ${result.manifestPath}`);
  } else if (action === "list") {
    const backups = listBackups(backupDirectory);
    if (!backups.length) console.log("No completed backups found.");
    for (const { manifest } of backups)
      console.log(
        `${manifest.backupId} | ${manifest.createdAt} | ${manifest.databaseName} | ${manifest.byteSize} bytes | ${manifest.sha256}`,
      );
  } else if (action === "verify") {
    const backupId = requireIdentifier(identifier);
    const result = await verifyBackupArtifact(backupDirectory, backupId);
    console.log(`Backup verified: ${result.manifest.backupId}`);
    console.log(`SHA-256: ${result.manifest.sha256}`);
  } else if (action === "restore") {
    const backupId = requireIdentifier(identifier);
    const targetDatabaseUrl = requireEnvironment("RESTORE_DATABASE_URL");
    const result = await restoreBackup({
      backupIdentifier: backupId,
      ...(backupDirectory ? { backupDirectory } : {}),
      targetDatabaseUrl,
      ...(process.env.DATABASE_URL
        ? {
            sourceDatabaseUrl: process.env.DATABASE_URL,
            developmentDatabaseUrl: process.env.DATABASE_URL,
          }
        : {}),
    });
    console.log(`Restore verified: ${result.targetDatabaseName}`);
    console.log(`Backup: ${result.manifest.backupId}`);
  } else {
    throw new DatabaseBackupError(
      "Usage: database-backup.ts <create|list|verify|restore> [backup-id]",
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Database backup command failed.");
  process.exitCode = 1;
}

function requireEnvironment(name: string) {
  const value = process.env[name];
  if (!value) throw new DatabaseBackupError(`${name} is required.`);
  return value;
}

function requireIdentifier(value: string | undefined) {
  if (!value) throw new DatabaseBackupError("A backup identifier is required.");
  return value;
}
