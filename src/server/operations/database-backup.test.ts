import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyRetention,
  assertSafeRestoreTarget,
  type BackupManifest,
  DatabaseBackupError,
  normalizeBackupIdentifier,
  verifyBackupArtifact,
} from "./database-backup";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("database restore safety", () => {
  const sourceUrl = "postgresql://user:secret@127.0.0.1:55433/factory_erp_test";
  const safety = {
    sourceDatabaseUrl: sourceUrl,
    developmentDatabaseUrl: "postgresql://user:secret@127.0.0.1:5432/factory_erp",
    sourceDatabaseName: "factory_erp_test",
  };

  it.each([
    sourceUrl,
    "postgresql://user:secret@127.0.0.1:55433/postgres",
    "postgresql://user:secret@127.0.0.1:55433/factory_erp",
    "postgresql://user:secret@127.0.0.1:55433/factory_erp_restore",
    "postgresql://user:secret@127.0.0.1:55433/factory_erp_test_only",
    "postgresql://user:secret@127.0.0.1:55433/factory_prod_restore_test",
  ])("rejects unsafe restore target %s", (target) => {
    expect(() => assertSafeRestoreTarget(target, safety)).toThrow(DatabaseBackupError);
  });

  it("accepts an isolated target with restore and test markers", () => {
    expect(
      assertSafeRestoreTarget(
        "postgresql://user:secret@127.0.0.1:55433/factory_erp_restore_test",
        safety,
      ).databaseName,
    ).toBe("factory_erp_restore_test");
  });

  it.each(["../backup", "..\\backup", "folder/backup", "", ".manifest.json"])(
    "rejects traversal or ambiguous backup identifier %s",
    (identifier) => {
      expect(() => normalizeBackupIdentifier(identifier)).toThrow(DatabaseBackupError);
    },
  );
});

describe("backup verification and retention", () => {
  it("rejects a checksum mismatch", async () => {
    const root = temporaryRoot();
    const record = writeBackup(root, "checksum-test", "original", new Date().toISOString());
    writeFileSync(record.dumpPath, "corrupt!", "utf8");
    await expect(verifyBackupArtifact(root, record.manifest.backupId)).rejects.toThrow(
      "SHA-256 checksum",
    );
  });

  it("removes only eligible backup pairs inside the configured root", () => {
    const root = temporaryRoot();
    const sentinel = path.join(path.dirname(root), `${path.basename(root)}-sentinel.txt`);
    writeFileSync(sentinel, "outside", "utf8");
    const old = writeBackup(root, "old", "old", "2000-01-01T00:00:00.000Z");
    const recent = writeBackup(root, "recent", "recent", "2026-08-31T00:00:00.000Z");

    expect(applyRetention(root, { keepLast: 1 }, new Date("2026-08-31T01:00:00.000Z"))).toEqual([
      "old",
    ]);
    expect(existsSync(old.dumpPath)).toBe(false);
    expect(existsSync(old.manifestPath)).toBe(false);
    expect(existsSync(recent.dumpPath)).toBe(true);
    expect(readFileSync(sentinel, "utf8")).toBe("outside");
    rmSync(sentinel, { force: true });
  });
});

function temporaryRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), "factory-erp-backup-test-"));
  temporaryDirectories.push(root);
  return root;
}

function writeBackup(root: string, backupId: string, contents: string, createdAt: string) {
  const dumpFilename = `${backupId}.dump`;
  const dumpPath = path.join(root, dumpFilename);
  const manifestPath = path.join(root, `${backupId}.manifest.json`);
  writeFileSync(dumpPath, contents, "utf8");
  const manifest: BackupManifest = {
    formatVersion: 1,
    backupFormat: "postgresql-custom",
    backupId,
    createdAt,
    databaseName: "factory_erp_test",
    postgresServerVersion: "16.0",
    postgresServerVersionNumber: 160000,
    applicationVersion: "0.1.0",
    gitCommitSha: null,
    dumpFilename,
    byteSize: Buffer.byteLength(contents),
    sha256: createHash("sha256").update(contents).digest("hex"),
    migrationCount: 39,
    latestMigration: "20260831100000_phase27_batch_packaging_integrality",
    backupToolVersion: "pg_dump (PostgreSQL) 16.0",
    status: "complete",
    sourceFacts: {
      counts: {
        items: 0,
        inventoryMovements: 0,
        valuationEntries: 0,
        valuationBalances: 0,
        productionBatches: 0,
        salesInvoices: 0,
        customerLedgerEntries: 0,
        supplierLedgerEntries: 0,
        accountingJournals: 0,
        accountingJournalLines: 0,
        auditEvents: 0,
      },
      totals: {
        inventoryMovementQuantity: "0",
        valuationEntryQuantity: "0",
        valuationEntryValue: "0",
        valuationBalanceQuantity: "0",
        valuationBalanceValue: "0",
        salesInvoiceGrandTotal: "0",
        customerLedgerAmount: "0",
        supplierLedgerAmount: "0",
        journalDebit: "0",
        journalCredit: "0",
        journalLineDebit: "0",
        journalLineCredit: "0",
      },
    },
  };
  writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
  return { dumpPath, manifestPath, manifest };
}
