# Backup and disaster recovery

Phase 28 provides PostgreSQL-native logical backups and a guarded restore path for the ERP source of truth. It does not deploy the application, schedule operating-system jobs, or copy artifacts off site.

## Backup contents and format

`backup:create` uses `pg_dump --format=custom` against `DATABASE_URL`. PostgreSQL's exported snapshot keeps the dump and the manifest's migration/fact snapshot transaction-consistent. The dump includes the complete application database: authentication, master data, purchasing, production, sales, physical and valuation ledgers, receivable/payable ledgers, accounting journals, audit events, and settings.

The default backup directory is the ignored `.backups/` directory. Set `BACKUP_DIRECTORY` to an operator-controlled location to store backups outside the repository. Actual dump files and local environment files must never be committed or copied into application archives.

Each successful backup produces:

- `<backup-id>.dump`: PostgreSQL custom-format archive;
- `<backup-id>.manifest.json`: format/version metadata, database name, server and tool versions, application version, Git SHA when available, migration state, byte size, SHA-256, and representative source facts.

The manifest contains no password, username, hostname, or connection URL. Creation writes a temporary dump, validates it with `pg_restore --list`, calculates SHA-256, renames the dump, and only then atomically publishes the manifest. A failed dump does not receive a successful manifest.

## Commands

The commands are Windows-friendly and use structured child-process arguments. PostgreSQL passwords are passed to child processes through `PGPASSWORD`, never command arguments or output.

```powershell
corepack pnpm backup:create
corepack pnpm backup:list
corepack pnpm backup:verify -- <backup-id>
```

The normal commands read `DATABASE_URL` from the ignored `.env`. Configure `BACKUP_DIRECTORY` when the default is unsuitable. PostgreSQL executables are discovered from `POSTGRES_BIN` and standard Windows PostgreSQL installations. `PG_DUMP_PATH` and `PG_RESTORE_PATH` may identify explicit executables when the standard discovery locations are unsuitable.

Restore requires an explicit isolated target URL supplied by the operator:

```powershell
$env:RESTORE_DATABASE_URL = "postgresql://operator@127.0.0.1:5432/factory_erp_restore_test"
corepack pnpm backup:restore -- <backup-id>
```

The automated restore command accepts only PostgreSQL database names containing both `restore` and `test` markers. It rejects the source database, the configured development database, PostgreSQL system databases, ambiguous names, and paths outside `BACKUP_DIRECTORY`. This command intentionally cannot overwrite production.

Before any target database is dropped or created, restore validates the manifest, regular-file boundaries, byte size, and SHA-256. It then recreates only the authorized target, runs `pg_restore` with error-stop and a single transaction, confirms connectivity and migration state, compares source facts, and checks accounting/inventory integrity. A restore is not successful merely because `pg_restore` exits zero.

## Restore drill

Run the destructive test only through the managed Phase 27/28 lifecycle:

```powershell
corepack pnpm backup:drill
```

The drill resets only `127.0.0.1:55433/factory_erp_test`, creates the supported golden workflow, backs it up, rejects unsafe targets and a checksum-corrupted test copy before database mutation, restores into the separate `factory_erp_restore_test`, and compares counts and exact totals for items, inventory, valuation, production, invoices, customer/supplier ledgers, journals/lines, and audit history.

The restored database must also prove:

- every posted journal and stored journal header balances;
- Accounts Receivable equals the customer ledger;
- Accounts Payable equals the supplier ledger;
- mapped inventory GL equals the inventory valuation balance;
- completed-batch WIP balances are zero;
- valuation balances contain no negative owned quantity/value and movements contain no zero entry;
- source audit-event counts are preserved.

The source and restore databases coexist after the drill for inspection. Neither uses the normal development database.

## Retention

Backup creation applies a simple union policy: keep at least the newest `BACKUP_KEEP_LAST` completed backups and every backup newer than `BACKUP_KEEP_DAYS`. Defaults are 14 backups and 30 days. Values must be positive integers.

Retention scans only valid manifests directly inside `BACKUP_DIRECTORY` and unlinks only their matching regular `.dump` and `.manifest.json` files. It does not recurse, accept traversal, follow symlinked artifacts, or delete unrelated files. An invalid manifest blocks the retention operation for operator review.

## Recovery procedure

For development or recovery rehearsal:

1. Choose a completed backup and run `backup:verify`.
2. Set `RESTORE_DATABASE_URL` to a new, explicit `*_restore_test` database.
3. Run `backup:restore` and retain its integrity output.
4. Point a separately configured application instance at the restored database for operator acceptance if needed.

For a real production disaster, do not weaken or bypass the automated target guard. Restore first to an isolated database/server, verify checksums and the full integrity report, obtain explicit operational approval, stop application writes, and use DBA-controlled PostgreSQL procedures to promote or copy the verified database. Production replacement, credentials, downtime coordination, and promotion remain a deliberate manual confirmation boundary outside this script.

## RPO, RTO, scheduling, and off-site copies

Provisional operating targets—not guaranteed SLAs—are:

- one logical backup daily;
- an additional manual backup before major upgrades or migrations;
- at least 14 recent backups and 30 days of recoverable artifacts by default;
- a restore drill after material schema/tooling changes and at least monthly in steady operation.

RPO is therefore up to 24 hours unless operators take additional backups. RTO is not yet guaranteed; it includes artifact retrieval, restore duration, integrity checks, and operator acceptance. Record real drill timings before setting an RTO commitment.

Phase 28 does not modify Windows Task Scheduler. Operators may create a least-privilege scheduled task that runs `corepack pnpm backup:create` from the repository with an appropriate service account, secret environment, external `BACKUP_DIRECTORY`, and monitored exit code.

Local success is not redundancy. Copy completed `.dump` and `.manifest.json` pairs to separately controlled offline or off-site storage and periodically restore from that copy. No Google Drive, Dropbox, S3, OneDrive, or other cloud integration exists in Phase 28.
