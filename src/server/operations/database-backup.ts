import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { Client } from "pg";

const FORMAT_VERSION = 1;
const BACKUP_FORMAT = "postgresql-custom";
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const countKeys = [
  "items",
  "inventoryMovements",
  "valuationEntries",
  "valuationBalances",
  "productionBatches",
  "salesInvoices",
  "customerLedgerEntries",
  "supplierLedgerEntries",
  "accountingJournals",
  "accountingJournalLines",
  "auditEvents",
] as const;

const totalKeys = [
  "inventoryMovementQuantity",
  "valuationEntryQuantity",
  "valuationEntryValue",
  "valuationBalanceQuantity",
  "valuationBalanceValue",
  "salesInvoiceGrandTotal",
  "customerLedgerAmount",
  "supplierLedgerAmount",
  "journalDebit",
  "journalCredit",
  "journalLineDebit",
  "journalLineCredit",
] as const;

type CountKey = (typeof countKeys)[number];
type TotalKey = (typeof totalKeys)[number];

export type DatabaseFacts = {
  counts: Record<CountKey, number>;
  totals: Record<TotalKey, string>;
};

export type BackupManifest = {
  formatVersion: number;
  backupFormat: typeof BACKUP_FORMAT;
  backupId: string;
  createdAt: string;
  databaseName: string;
  postgresServerVersion: string;
  postgresServerVersionNumber: number;
  applicationVersion: string;
  gitCommitSha: string | null;
  dumpFilename: string;
  byteSize: number;
  sha256: string;
  migrationCount: number;
  latestMigration: string | null;
  backupToolVersion: string;
  status: "complete";
  sourceFacts: DatabaseFacts;
};

export type RetentionPolicy = {
  keepLast?: number;
  keepDays?: number;
};

export type BackupOptions = {
  databaseUrl: string;
  backupDirectory?: string;
  postgresBin?: string;
  retention?: RetentionPolicy | false;
  now?: Date;
};

export type RestoreSafety = {
  sourceDatabaseUrl?: string;
  developmentDatabaseUrl?: string;
  sourceDatabaseName: string;
};

export type RestoreOptions = {
  backupIdentifier: string;
  backupDirectory?: string;
  targetDatabaseUrl: string;
  sourceDatabaseUrl?: string;
  developmentDatabaseUrl?: string;
  postgresBin?: string;
};

export type RestoreIntegrity = {
  expectedTables: boolean;
  migrationsMatch: boolean;
  factsMatch: boolean;
  journalBalance: boolean;
  arReconciliation: boolean;
  apReconciliation: boolean;
  inventoryReconciliation: boolean;
  wipReconciliation: boolean;
  inventoryHealthy: boolean;
  auditPreserved: boolean;
};

export type RestoreResult = {
  manifest: BackupManifest;
  targetDatabaseName: string;
  restoredFacts: DatabaseFacts;
  integrity: RestoreIntegrity;
};

type DatabaseEndpoint = {
  url: string;
  host: string;
  port: string;
  username: string;
  password: string;
  databaseName: string;
  sslMode?: string;
};

type MigrationState = { count: number; latest: string | null };

export class DatabaseBackupError extends Error {}

export function defaultBackupDirectory() {
  return path.join(repositoryRoot, ".backups");
}

export async function createBackup(options: BackupOptions) {
  const endpoint = parseDatabaseUrl(options.databaseUrl, "DATABASE_URL");
  const backupDirectory = resolveBackupDirectory(options.backupDirectory);
  ensureBackupDirectory(backupDirectory);
  const pgDump = resolvePostgresTool("pg_dump", options.postgresBin);
  const pgRestore = resolvePostgresTool("pg_restore", options.postgresBin);
  const backupToolVersion = runTool(pgDump, ["--version"]).stdout;
  const dumpMajor = parsePostgresMajor(backupToolVersion, "pg_dump");
  const createdAt = options.now ?? new Date();
  const backupId = createBackupId(endpoint.databaseName, createdAt);
  const dumpFilename = `${backupId}.dump`;
  const manifestFilename = `${backupId}.manifest.json`;
  const finalDumpPath = insideRoot(backupDirectory, dumpFilename);
  const finalManifestPath = insideRoot(backupDirectory, manifestFilename);
  const temporaryDumpPath = insideRoot(backupDirectory, `.${backupId}.${randomUUID()}.dump.tmp`);
  const temporaryManifestPath = insideRoot(
    backupDirectory,
    `.${backupId}.${randomUUID()}.manifest.tmp`,
  );
  let dumpFinalized = false;
  let manifestFinalized = false;
  let client: Client | undefined;

  try {
    client = new Client({ connectionString: endpoint.url });
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const snapshot = await client.query<{ snapshot: string }>(
      'SELECT pg_export_snapshot() AS "snapshot"',
    );
    const snapshotId = snapshot.rows[0]?.snapshot;
    if (!snapshotId) throw new DatabaseBackupError("Could not export a backup snapshot.");
    const versionResult = await client.query<{ version: string; versionNumber: string }>(
      "SELECT current_setting('server_version') AS \"version\", current_setting('server_version_num') AS \"versionNumber\"",
    );
    const postgresServerVersion = versionResult.rows[0]?.version;
    const postgresServerVersionNumber = Number(versionResult.rows[0]?.versionNumber);
    if (!postgresServerVersion || !Number.isInteger(postgresServerVersionNumber))
      throw new DatabaseBackupError("Could not read the PostgreSQL server version.");
    const serverMajor = Math.floor(postgresServerVersionNumber / 10_000);
    if (dumpMajor < serverMajor)
      throw new DatabaseBackupError(
        `pg_dump ${dumpMajor} is older than PostgreSQL server ${serverMajor}; use compatible PostgreSQL tools.`,
      );
    const migrationState = await readMigrationState(client);
    const sourceFacts = await collectDatabaseFacts(client);
    runTool(
      pgDump,
      [
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        `--snapshot=${snapshotId}`,
        `--file=${temporaryDumpPath}`,
        ...connectionArguments(endpoint),
      ],
      endpoint,
    );
    await client.query("COMMIT");
    await client.end();
    client = undefined;

    assertRegularFile(temporaryDumpPath, "Temporary database dump");
    if (statSync(temporaryDumpPath).size === 0)
      throw new DatabaseBackupError("pg_dump created an empty backup artifact.");
    runTool(pgRestore, ["--list", temporaryDumpPath]);
    const sha256 = await checksumFile(temporaryDumpPath);
    const byteSize = statSync(temporaryDumpPath).size;
    renameSync(temporaryDumpPath, finalDumpPath);
    dumpFinalized = true;

    const manifest: BackupManifest = {
      formatVersion: FORMAT_VERSION,
      backupFormat: BACKUP_FORMAT,
      backupId,
      createdAt: createdAt.toISOString(),
      databaseName: endpoint.databaseName,
      postgresServerVersion,
      postgresServerVersionNumber,
      applicationVersion: readApplicationVersion(),
      gitCommitSha: readGitCommitSha(),
      dumpFilename,
      byteSize,
      sha256,
      migrationCount: migrationState.count,
      latestMigration: migrationState.latest,
      backupToolVersion,
      status: "complete",
      sourceFacts,
    };
    writeFileSync(temporaryManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    renameSync(temporaryManifestPath, finalManifestPath);
    manifestFinalized = true;
    await verifyBackupArtifact(backupDirectory, backupId);
    if (options.retention !== false)
      applyRetention(
        backupDirectory,
        options.retention ?? retentionPolicyFromEnvironment(process.env),
        createdAt,
      );
    return { manifest, dumpPath: finalDumpPath, manifestPath: finalManifestPath };
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      await client.end().catch(() => undefined);
    }
    safeUnlink(temporaryDumpPath);
    safeUnlink(temporaryManifestPath);
    if (manifestFinalized) safeUnlink(finalManifestPath);
    if (dumpFinalized) safeUnlink(finalDumpPath);
    if (error instanceof DatabaseBackupError) throw error;
    throw new DatabaseBackupError(
      `Database backup failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

export async function verifyBackupArtifact(
  backupDirectory: string | undefined,
  identifier: string,
) {
  const root = resolveBackupDirectory(backupDirectory);
  assertExistingBackupDirectory(root);
  const backupId = normalizeBackupIdentifier(identifier);
  const manifestPath = insideRoot(root, `${backupId}.manifest.json`);
  assertRegularFile(manifestPath, "Backup manifest");
  const manifest = parseManifest(readFileSync(manifestPath, "utf8"), backupId);
  const dumpPath = insideRoot(root, manifest.dumpFilename);
  assertRegularFile(dumpPath, "Database dump");
  const actualSize = statSync(dumpPath).size;
  if (actualSize !== manifest.byteSize)
    throw new DatabaseBackupError("Backup byte size does not match its manifest.");
  const actualChecksum = await checksumFile(dumpPath);
  if (actualChecksum !== manifest.sha256)
    throw new DatabaseBackupError("Backup SHA-256 checksum does not match its manifest.");
  return { manifest, manifestPath, dumpPath };
}

export function listBackups(backupDirectory?: string) {
  const root = resolveBackupDirectory(backupDirectory);
  if (!existsSync(root)) return [];
  assertExistingBackupDirectory(root);
  return readManifestRecords(root).sort((left, right) =>
    right.manifest.createdAt.localeCompare(left.manifest.createdAt),
  );
}

export async function restoreBackup(options: RestoreOptions): Promise<RestoreResult> {
  const verified = await verifyBackupArtifact(options.backupDirectory, options.backupIdentifier);
  const target = parseDatabaseUrl(options.targetDatabaseUrl, "RESTORE_DATABASE_URL");
  assertSafeRestoreTarget(target.url, {
    sourceDatabaseName: verified.manifest.databaseName,
    ...(options.sourceDatabaseUrl ? { sourceDatabaseUrl: options.sourceDatabaseUrl } : {}),
    ...(options.developmentDatabaseUrl
      ? { developmentDatabaseUrl: options.developmentDatabaseUrl }
      : {}),
  });
  const pgRestore = resolvePostgresTool("pg_restore", options.postgresBin);
  runTool(pgRestore, ["--list", verified.dumpPath]);
  await resetSafeRestoreDatabase(target, options);
  runTool(
    pgRestore,
    [
      "--exit-on-error",
      "--single-transaction",
      "--no-owner",
      "--no-privileges",
      ...connectionArguments(target),
      verified.dumpPath,
    ],
    target,
  );
  const inspection = await inspectRestoredDatabase(target.url, verified.manifest);
  assertIntegrity(inspection.integrity);
  return {
    manifest: verified.manifest,
    targetDatabaseName: target.databaseName,
    restoredFacts: inspection.restoredFacts,
    integrity: inspection.integrity,
  };
}

export function assertSafeRestoreTarget(targetUrl: string, safety: RestoreSafety) {
  const target = parseDatabaseUrl(targetUrl, "RESTORE_DATABASE_URL");
  if (["postgres", "template0", "template1"].includes(target.databaseName.toLowerCase()))
    throw new DatabaseBackupError("Restore target is a PostgreSQL system database.");
  if (/(?:^|[-_])(?:prod|production)(?:$|[-_])/i.test(target.databaseName))
    throw new DatabaseBackupError("Restore target appears to be a production database.");
  if (
    !/(?:^|[-_])restore(?:$|[-_])/i.test(target.databaseName) ||
    !/(?:^|[-_])test(?:$|[-_])/i.test(target.databaseName)
  )
    throw new DatabaseBackupError(
      "Restore target name must contain explicit restore and test markers.",
    );
  if (target.databaseName.toLowerCase() === safety.sourceDatabaseName.toLowerCase())
    throw new DatabaseBackupError("Restore target must not be the source backup database.");
  for (const protectedUrl of [safety.sourceDatabaseUrl, safety.developmentDatabaseUrl]) {
    if (!protectedUrl) continue;
    const protectedEndpoint = parseDatabaseUrl(protectedUrl, "protected database URL");
    if (sameDatabase(target, protectedEndpoint))
      throw new DatabaseBackupError("Restore target must not overwrite a protected database.");
  }
  return target;
}

export async function removeSafeRestoreDatabase(
  targetDatabaseUrl: string,
  safety: RestoreSafety,
  postgresBin?: string,
) {
  const target = assertSafeRestoreTarget(targetDatabaseUrl, safety);
  const dropdb = resolvePostgresTool("dropdb", postgresBin);
  runTool(
    dropdb,
    [...serverArguments(target), "--if-exists", "--force", target.databaseName],
    target,
  );
}

export async function databaseExists(databaseUrl: string) {
  const endpoint = parseDatabaseUrl(databaseUrl, "database URL");
  const maintenanceUrl = databaseUrlFor(endpoint, "postgres");
  const client = new Client({ connectionString: maintenanceUrl });
  try {
    await client.connect();
    const result = await client.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS "exists"',
      [endpoint.databaseName],
    );
    return Boolean(result.rows[0]?.exists);
  } finally {
    await client.end().catch(() => undefined);
  }
}

export function applyRetention(
  backupDirectory: string | undefined,
  policy: RetentionPolicy,
  now = new Date(),
) {
  const root = resolveBackupDirectory(backupDirectory);
  validateRetentionPolicy(policy);
  if (!existsSync(root)) return [];
  assertExistingBackupDirectory(root);
  const records = readManifestRecords(root).sort((left, right) =>
    right.manifest.createdAt.localeCompare(left.manifest.createdAt),
  );
  const cutoff =
    policy.keepDays === undefined
      ? undefined
      : now.getTime() - policy.keepDays * 24 * 60 * 60 * 1000;
  const removed: string[] = [];
  records.forEach((record, index) => {
    const withinCount = policy.keepLast !== undefined && index < policy.keepLast;
    const withinAge =
      cutoff !== undefined && new Date(record.manifest.createdAt).getTime() >= cutoff;
    const configured = policy.keepLast !== undefined || cutoff !== undefined;
    if (!configured || withinCount || withinAge) return;
    const dumpPath = insideRoot(root, record.manifest.dumpFilename);
    assertRegularFile(record.manifestPath, "Retention manifest");
    assertRegularFile(dumpPath, "Retention dump");
    unlinkSync(dumpPath);
    unlinkSync(record.manifestPath);
    removed.push(record.manifest.backupId);
  });
  return removed;
}

export function retentionPolicyFromEnvironment(environment: NodeJS.ProcessEnv): RetentionPolicy {
  return {
    keepLast: parseRetentionInteger(environment.BACKUP_KEEP_LAST, 14, "BACKUP_KEEP_LAST"),
    keepDays: parseRetentionInteger(environment.BACKUP_KEEP_DAYS, 30, "BACKUP_KEEP_DAYS"),
  };
}

export function normalizeBackupIdentifier(identifier: string) {
  const trimmed = identifier.trim();
  const backupId = trimmed.endsWith(".manifest.json")
    ? trimmed.slice(0, -".manifest.json".length)
    : trimmed;
  if (
    !backupId ||
    backupId.includes("..") ||
    backupId.includes("/") ||
    backupId.includes("\\") ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(backupId)
  )
    throw new DatabaseBackupError("Backup identifier is invalid or attempts path traversal.");
  return backupId;
}

async function resetSafeRestoreDatabase(target: DatabaseEndpoint, options: RestoreOptions) {
  const dropdb = resolvePostgresTool("dropdb", options.postgresBin);
  const createdb = resolvePostgresTool("createdb", options.postgresBin);
  const maintenanceUrl = databaseUrlFor(target, "postgres");
  const maintenance = new Client({ connectionString: maintenanceUrl });
  try {
    await maintenance.connect();
    await maintenance.query("SELECT 1");
  } catch {
    throw new DatabaseBackupError("Restore PostgreSQL server is unreachable or rejected access.");
  } finally {
    await maintenance.end().catch(() => undefined);
  }
  runTool(
    dropdb,
    [...serverArguments(target), "--if-exists", "--force", target.databaseName],
    target,
  );
  runTool(createdb, [...serverArguments(target), target.databaseName], target);
}

async function inspectRestoredDatabase(url: string, manifest: BackupManifest) {
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    await client.query("SELECT 1");
    const tableNames = [
      "item",
      "inventory_movement",
      "inventory_valuation_entry",
      "inventory_valuation_balance",
      "production_batch",
      "sales_invoice",
      "customer_ledger_entry",
      "supplier_payable_ledger_entry",
      "accounting_journal",
      "accounting_journal_line",
      "audit_event",
      "_prisma_migrations",
    ];
    const expectedTablesResult = await client.query<{ missing: string[] | null }>(
      `SELECT array_agg(name) FILTER (WHERE to_regclass('public.' || name) IS NULL) AS "missing"
       FROM unnest($1::text[]) AS name`,
      [tableNames],
    );
    const migrations = await readMigrationState(client);
    const restoredFacts = await collectDatabaseFacts(client);
    const journalResult = await client.query<{ failures: string }>(`
      SELECT count(*)::text AS "failures"
      FROM (
        SELECT j."id"
        FROM "accounting_journal" j
        LEFT JOIN "accounting_journal_line" l ON l."journalId" = j."id"
        WHERE j."status" = 'POSTED'
        GROUP BY j."id", j."totalDebit", j."totalCredit"
        HAVING COALESCE(SUM(l."debit"), 0) <> COALESCE(SUM(l."credit"), 0)
          OR COALESCE(SUM(l."debit"), 0) <> j."totalDebit"
          OR COALESCE(SUM(l."credit"), 0) <> j."totalCredit"
      ) failures
    `);
    const reconciliation = await client.query<{
      ar: boolean;
      ap: boolean;
      inventory: boolean;
    }>(`
      WITH mapped AS (
        SELECT m."mappingKey", m."accountId"
        FROM "accounting_account_mapping" m
        WHERE m."accountingSettingsId" = 'default'
      ), gl AS (
        SELECT l."accountId",
          COALESCE(SUM(CASE WHEN j."status" = 'POSTED' THEN l."debit" - l."credit" ELSE 0 END), 0) AS balance
        FROM "accounting_journal_line" l
        JOIN "accounting_journal" j ON j."id" = l."journalId"
        GROUP BY l."accountId"
      )
      SELECT
        COALESCE((SELECT balance FROM gl JOIN mapped ON mapped."accountId" = gl."accountId" WHERE mapped."mappingKey" = 'ACCOUNTS_RECEIVABLE'), 0)
          = COALESCE((SELECT SUM("signedAmount") FROM "customer_ledger_entry"), 0) AS ar,
        -COALESCE((SELECT balance FROM gl JOIN mapped ON mapped."accountId" = gl."accountId" WHERE mapped."mappingKey" = 'ACCOUNTS_PAYABLE'), 0)
          = COALESCE((SELECT SUM("signedAmount") FROM "supplier_payable_ledger_entry"), 0) AS ap,
        COALESCE((SELECT SUM(gl.balance) FROM gl JOIN mapped ON mapped."accountId" = gl."accountId" WHERE mapped."mappingKey" IN ('RAW_MATERIAL_INVENTORY', 'PACKAGING_INVENTORY', 'FINISHED_GOODS_INVENTORY')), 0)
          = COALESCE((SELECT SUM("inventoryValue") FROM "inventory_valuation_balance"), 0) AS inventory
    `);
    const wipResult = await client.query<{ failures: string }>(`
      WITH wip AS (
        SELECT m."accountId"
        FROM "accounting_account_mapping" m
        WHERE m."accountingSettingsId" = 'default' AND m."mappingKey" = 'WORK_IN_PROCESS'
      )
      SELECT count(*)::text AS "failures"
      FROM (
        SELECT b."id"
        FROM "production_batch" b
        LEFT JOIN "accounting_journal_line" l ON l."productionBatchId" = b."id"
        LEFT JOIN "accounting_journal" j ON j."id" = l."journalId" AND j."status" = 'POSTED'
        LEFT JOIN wip ON wip."accountId" = l."accountId"
        WHERE b."status" = 'COMPLETED'
        GROUP BY b."id"
        HAVING COALESCE(SUM(CASE WHEN wip."accountId" IS NOT NULL AND j."id" IS NOT NULL THEN l."debit" - l."credit" ELSE 0 END), 0) <> 0
      ) failures
    `);
    const inventoryHealth = await client.query<{ failures: string }>(`
      SELECT (
        (SELECT count(*) FROM "inventory_valuation_balance" WHERE "ownedQuantity" < 0 OR "inventoryValue" < 0)
        + (SELECT count(*) FROM "inventory_movement" WHERE "quantity" = 0)
      )::text AS "failures"
    `);
    const integrity: RestoreIntegrity = {
      expectedTables: (expectedTablesResult.rows[0]?.missing?.length ?? 0) === 0,
      migrationsMatch:
        migrations.count === manifest.migrationCount &&
        migrations.latest === manifest.latestMigration,
      factsMatch: factsEqual(restoredFacts, manifest.sourceFacts),
      journalBalance: Number(journalResult.rows[0]?.failures ?? "1") === 0,
      arReconciliation: Boolean(reconciliation.rows[0]?.ar),
      apReconciliation: Boolean(reconciliation.rows[0]?.ap),
      inventoryReconciliation: Boolean(reconciliation.rows[0]?.inventory),
      wipReconciliation: Number(wipResult.rows[0]?.failures ?? "1") === 0,
      inventoryHealthy: Number(inventoryHealth.rows[0]?.failures ?? "1") === 0,
      auditPreserved:
        manifest.sourceFacts.counts.auditEvents === restoredFacts.counts.auditEvents &&
        (manifest.sourceFacts.counts.auditEvents === 0 || restoredFacts.counts.auditEvents > 0),
    };
    return { restoredFacts, integrity };
  } catch (error) {
    if (error instanceof DatabaseBackupError) throw error;
    throw new DatabaseBackupError(
      `Post-restore integrity inspection failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

function assertIntegrity(integrity: RestoreIntegrity) {
  const failures = Object.entries(integrity)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failures.length)
    throw new DatabaseBackupError(`Post-restore integrity checks failed: ${failures.join(", ")}.`);
}

async function readMigrationState(client: Client): Promise<MigrationState> {
  const result = await client.query<{ count: string; latest: string | null }>(`
    SELECT count(*)::text AS "count", max("migration_name") AS "latest"
    FROM "_prisma_migrations"
    WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
  `);
  return { count: Number(result.rows[0]?.count ?? 0), latest: result.rows[0]?.latest ?? null };
}

async function collectDatabaseFacts(client: Client): Promise<DatabaseFacts> {
  const result = await client.query<Record<string, string>>(`
    SELECT
      (SELECT count(*)::text FROM "item") AS "items",
      (SELECT count(*)::text FROM "inventory_movement") AS "inventoryMovements",
      (SELECT count(*)::text FROM "inventory_valuation_entry") AS "valuationEntries",
      (SELECT count(*)::text FROM "inventory_valuation_balance") AS "valuationBalances",
      (SELECT count(*)::text FROM "production_batch") AS "productionBatches",
      (SELECT count(*)::text FROM "sales_invoice") AS "salesInvoices",
      (SELECT count(*)::text FROM "customer_ledger_entry") AS "customerLedgerEntries",
      (SELECT count(*)::text FROM "supplier_payable_ledger_entry") AS "supplierLedgerEntries",
      (SELECT count(*)::text FROM "accounting_journal") AS "accountingJournals",
      (SELECT count(*)::text FROM "accounting_journal_line") AS "accountingJournalLines",
      (SELECT count(*)::text FROM "audit_event") AS "auditEvents",
      (SELECT COALESCE(SUM("quantity"), 0)::text FROM "inventory_movement") AS "inventoryMovementQuantity",
      (SELECT COALESCE(SUM("quantityEffect"), 0)::text FROM "inventory_valuation_entry") AS "valuationEntryQuantity",
      (SELECT COALESCE(SUM("valueDelta"), 0)::text FROM "inventory_valuation_entry") AS "valuationEntryValue",
      (SELECT COALESCE(SUM("ownedQuantity"), 0)::text FROM "inventory_valuation_balance") AS "valuationBalanceQuantity",
      (SELECT COALESCE(SUM("inventoryValue"), 0)::text FROM "inventory_valuation_balance") AS "valuationBalanceValue",
      (SELECT COALESCE(SUM("grandTotal"), 0)::text FROM "sales_invoice") AS "salesInvoiceGrandTotal",
      (SELECT COALESCE(SUM("signedAmount"), 0)::text FROM "customer_ledger_entry") AS "customerLedgerAmount",
      (SELECT COALESCE(SUM("signedAmount"), 0)::text FROM "supplier_payable_ledger_entry") AS "supplierLedgerAmount",
      (SELECT COALESCE(SUM("totalDebit"), 0)::text FROM "accounting_journal") AS "journalDebit",
      (SELECT COALESCE(SUM("totalCredit"), 0)::text FROM "accounting_journal") AS "journalCredit",
      (SELECT COALESCE(SUM("debit"), 0)::text FROM "accounting_journal_line") AS "journalLineDebit",
      (SELECT COALESCE(SUM("credit"), 0)::text FROM "accounting_journal_line") AS "journalLineCredit"
  `);
  const row = result.rows[0] ?? {};
  return {
    counts: Object.fromEntries(countKeys.map((key) => [key, Number(row[key] ?? 0)])) as Record<
      CountKey,
      number
    >,
    totals: Object.fromEntries(totalKeys.map((key) => [key, row[key] ?? "0"])) as Record<
      TotalKey,
      string
    >,
  };
}

function factsEqual(left: DatabaseFacts, right: DatabaseFacts) {
  return (
    countKeys.every((key) => left.counts[key] === right.counts[key]) &&
    totalKeys.every((key) => left.totals[key] === right.totals[key])
  );
}

function parseManifest(contents: string, expectedBackupId: string): BackupManifest {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new DatabaseBackupError("Backup manifest is not valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new DatabaseBackupError("Backup manifest has an invalid structure.");
  const candidate = value as Partial<BackupManifest>;
  if (
    candidate.formatVersion !== FORMAT_VERSION ||
    candidate.backupFormat !== BACKUP_FORMAT ||
    candidate.backupId !== expectedBackupId ||
    candidate.status !== "complete" ||
    typeof candidate.createdAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.createdAt)) ||
    typeof candidate.databaseName !== "string" ||
    typeof candidate.dumpFilename !== "string" ||
    candidate.dumpFilename !== `${expectedBackupId}.dump` ||
    typeof candidate.byteSize !== "number" ||
    !Number.isSafeInteger(candidate.byteSize) ||
    candidate.byteSize <= 0 ||
    typeof candidate.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(candidate.sha256) ||
    typeof candidate.postgresServerVersion !== "string" ||
    typeof candidate.postgresServerVersionNumber !== "number" ||
    typeof candidate.applicationVersion !== "string" ||
    !(candidate.gitCommitSha === null || typeof candidate.gitCommitSha === "string") ||
    typeof candidate.migrationCount !== "number" ||
    !Number.isSafeInteger(candidate.migrationCount) ||
    !(candidate.latestMigration === null || typeof candidate.latestMigration === "string") ||
    typeof candidate.backupToolVersion !== "string" ||
    !isDatabaseFacts(candidate.sourceFacts)
  )
    throw new DatabaseBackupError("Backup manifest failed schema validation.");
  normalizeBackupIdentifier(candidate.dumpFilename.slice(0, -".dump".length));
  return candidate as BackupManifest;
}

function isDatabaseFacts(value: unknown): value is DatabaseFacts {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const facts = value as Partial<DatabaseFacts>;
  if (!facts.counts || !facts.totals) return false;
  return (
    countKeys.every(
      (key) => Number.isSafeInteger(facts.counts?.[key]) && Number(facts.counts?.[key]) >= 0,
    ) && totalKeys.every((key) => typeof facts.totals?.[key] === "string")
  );
}

function readManifestRecords(root: string) {
  return readdirSync(root)
    .filter((name) => name.endsWith(".manifest.json"))
    .map((name) => {
      const backupId = normalizeBackupIdentifier(name);
      const manifestPath = insideRoot(root, name);
      assertRegularFile(manifestPath, "Backup manifest");
      return {
        manifest: parseManifest(readFileSync(manifestPath, "utf8"), backupId),
        manifestPath,
      };
    });
}

function resolveBackupDirectory(value?: string) {
  return path.resolve(value ?? process.env.BACKUP_DIRECTORY ?? defaultBackupDirectory());
}

function ensureBackupDirectory(root: string) {
  try {
    mkdirSync(root, { recursive: true });
    if (!lstatSync(root).isDirectory())
      throw new DatabaseBackupError("Configured backup location is not a directory.");
  } catch (error) {
    if (error instanceof DatabaseBackupError) throw error;
    throw new DatabaseBackupError("Configured backup directory cannot be created or accessed.");
  }
}

function assertExistingBackupDirectory(root: string) {
  try {
    if (!lstatSync(root).isDirectory())
      throw new DatabaseBackupError(
        "Configured backup location is missing, is not a directory, or is a symbolic link.",
      );
  } catch (error) {
    if (error instanceof DatabaseBackupError) throw error;
    throw new DatabaseBackupError("Configured backup directory cannot be accessed.");
  }
}

function insideRoot(root: string, filename: string) {
  if (path.basename(filename) !== filename)
    throw new DatabaseBackupError("Backup artifact filename attempts path traversal.");
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, filename);
  if (path.dirname(target).toLocaleLowerCase() !== resolvedRoot.toLocaleLowerCase())
    throw new DatabaseBackupError("Backup artifact resolves outside the backup directory.");
  return target;
}

function assertRegularFile(filePath: string, label: string) {
  if (!existsSync(filePath) || !lstatSync(filePath).isFile())
    throw new DatabaseBackupError(`${label} is missing or is not a regular file.`);
}

function parseDatabaseUrl(value: string, label: string): DatabaseEndpoint {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DatabaseBackupError(`${label} must be a valid PostgreSQL URL.`);
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new DatabaseBackupError(`${label} must use PostgreSQL.`);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!databaseName || databaseName.includes("/"))
    throw new DatabaseBackupError(`${label} must name one PostgreSQL database.`);
  if (!url.hostname) throw new DatabaseBackupError(`${label} must include a database host.`);
  const sslMode = url.searchParams.get("sslmode") ?? undefined;
  return {
    url: value,
    host: url.hostname,
    port: url.port || "5432",
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    databaseName,
    ...(sslMode ? { sslMode } : {}),
  };
}

function sameDatabase(left: DatabaseEndpoint, right: DatabaseEndpoint) {
  return (
    left.host.toLowerCase() === right.host.toLowerCase() &&
    left.port === right.port &&
    left.databaseName.toLowerCase() === right.databaseName.toLowerCase()
  );
}

function databaseUrlFor(endpoint: DatabaseEndpoint, databaseName: string) {
  const url = new URL(endpoint.url);
  url.pathname = `/${encodeURIComponent(databaseName)}`;
  url.searchParams.delete("schema");
  return url.toString();
}

function connectionArguments(endpoint: DatabaseEndpoint) {
  return [...serverArguments(endpoint), `--dbname=${endpoint.databaseName}`];
}

function serverArguments(endpoint: DatabaseEndpoint) {
  return [
    `--host=${endpoint.host}`,
    `--port=${endpoint.port}`,
    ...(endpoint.username ? [`--username=${endpoint.username}`] : []),
  ];
}

function toolEnvironment(endpoint?: DatabaseEndpoint): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...(endpoint?.password ? { PGPASSWORD: endpoint.password } : {}),
    ...(endpoint?.sslMode ? { PGSSLMODE: endpoint.sslMode } : {}),
  };
}

export function resolvePostgresTool(tool: string, postgresBin?: string) {
  const explicitName =
    tool === "pg_dump" ? "PG_DUMP_PATH" : tool === "pg_restore" ? "PG_RESTORE_PATH" : undefined;
  const explicit = explicitName ? process.env[explicitName] : undefined;
  if (explicit) {
    if (!existsSync(explicit))
      throw new DatabaseBackupError(`${explicitName} does not identify an existing executable.`);
    return path.resolve(explicit);
  }
  const executableName = process.platform === "win32" ? `${tool}.exe` : tool;
  const candidates = [
    postgresBin,
    process.env.POSTGRES_BIN,
    ...[18, 17, 16, 15, 14].map((version) =>
      path.join(
        process.env.ProgramFiles ?? "C:\\Program Files",
        "PostgreSQL",
        String(version),
        "bin",
      ),
    ),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const found = candidates
    .map((candidate) => path.join(candidate, executableName))
    .find((candidate) => existsSync(candidate));
  if (found) return found;
  const pathResult = spawnSync(executableName, ["--version"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: "ignore",
  });
  if (pathResult.status !== 0)
    throw new DatabaseBackupError(
      `${tool} was not found. Set POSTGRES_BIN${explicitName ? ` or ${explicitName}` : ""}.`,
    );
  return executableName;
}

function runTool(command: string, args: readonly string[], endpoint?: DatabaseEndpoint) {
  const result = spawnSync(command, [...args], {
    cwd: repositoryRoot,
    env: toolEnvironment(endpoint),
    encoding: "utf8",
    stdio: "pipe",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error)
    throw new DatabaseBackupError(`${path.basename(command)} could not be started.`);
  if (result.status !== 0) {
    const detail = result.stderr?.trim();
    throw new DatabaseBackupError(
      `${path.basename(command)} failed with exit code ${result.status ?? "unknown"}${detail ? `: ${detail}` : "."}`,
    );
  }
  return { stdout: result.stdout?.trim() ?? "", stderr: result.stderr?.trim() ?? "" };
}

function parsePostgresMajor(version: string, tool: string) {
  const match = version.match(/(\d+)(?:\.\d+)?/);
  const major = Number(match?.[1]);
  if (!Number.isInteger(major))
    throw new DatabaseBackupError(`Could not determine ${tool} version.`);
  return major;
}

async function checksumFile(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", () =>
      reject(new DatabaseBackupError("Backup checksum calculation failed.")),
    );
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function createBackupId(databaseName: string, createdAt: Date) {
  const safeDatabase =
    databaseName.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "database";
  const timestamp = createdAt.toISOString().replace(/[-:.]/g, "");
  return `${safeDatabase}-${timestamp}-${randomUUID().slice(0, 8)}`;
}

function readApplicationVersion() {
  try {
    const pkg = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

function readGitCommitSha() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: "pipe",
  });
  return result.status === 0 && /^[a-f0-9]{40}$/i.test(result.stdout.trim())
    ? result.stdout.trim()
    : null;
}

function validateRetentionPolicy(policy: RetentionPolicy) {
  for (const [name, value] of Object.entries(policy))
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1))
      throw new DatabaseBackupError(`${name} must be a positive integer.`);
}

function parseRetentionInteger(value: string | undefined, fallback: number, name: string) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new DatabaseBackupError(`${name} must be a positive integer.`);
  return parsed;
}

function safeUnlink(filePath: string) {
  try {
    if (existsSync(filePath) && lstatSync(filePath).isFile()) unlinkSync(filePath);
  } catch {}
}
