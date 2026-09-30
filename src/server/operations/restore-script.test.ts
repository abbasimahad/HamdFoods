import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const script = path.resolve("installer/scripts/Restore-HamdFoodsERP.ps1");
const source = readFileSync(script, "utf8");

describe("INST-9 installed restore tool", () => {
  it("stops the ERP, backs up the current data, restores, migrates, then restarts — in that order", () => {
    const order = [
      "'Type RESTORE to continue'",
      "'-Mode', 'StopRuntime'",
      "'database-backup.mjs'), 'create'",
      "'restore-live', $backupId",
      "'migrate', 'deploy'",
      "seed-all.mjs",
      "Start-ScheduledTask -TaskName $taskName",
    ].map((marker) => {
      const index = source.indexOf(marker);
      expect(index, marker).toBeGreaterThan(-1);
      return index;
    });
    expect([...order].sort((left, right) => left - right)).toEqual(order);
  });

  it("passes the PostgreSQL administrator password only through the child environment", () => {
    expect(source).toContain(
      "$env:POSTGRES_ADMIN_PASSWORD = $credential.GetNetworkCredential().Password",
    );
    expect(source).toContain("Remove-Item Env:POSTGRES_ADMIN_PASSWORD");
    // It may appear in -SensitiveValues (so it is redacted from logs) but never in an argument list.
    expect(source).not.toMatch(/-Arguments @\([^)\n]*POSTGRES_ADMIN_PASSWORD/);
    expect(source).not.toMatch(/ArgumentList[^\n]*POSTGRES_ADMIN_PASSWORD/);
    expect(source).not.toMatch(/stopArguments[^\n]*POSTGRES_ADMIN_PASSWORD/);
  });

  it.runIf(process.platform === "win32")("parses as valid Windows PowerShell", () => {
    const powershell = path.win32.join(
      process.env.SystemRoot ?? "C:\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const result = spawnSync(
      powershell,
      [
        "-NoLogo",
        "-NoProfile",
        "-Command",
        `$e=$null; $null=[Management.Automation.Language.Parser]::ParseFile('${script.replaceAll("'", "''")}', [ref]$null, [ref]$e); $e.Count`,
      ],
      { encoding: "utf8" },
    );
    expect(result.stdout.trim()).toBe("0");
  });
});
