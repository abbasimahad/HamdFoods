import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { dpapiProtect, dpapiUnprotect, resolveDpapiScriptPath } from "./dpapi";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const windowsIt = process.platform === "win32" ? it : it.skip;

describe("resolveDpapiScriptPath", () => {
  it("resolves the repository installer script when no data root is configured", () => {
    const resolved = resolveDpapiScriptPath({ repositoryRoot });
    expect(resolved).toBe(
      path.join(repositoryRoot, "installer", "scripts", "Dpapi-HamdFoodsERP.ps1"),
    );
  });

  it("resolves the sibling installed windows directory when a data root is configured", () => {
    const resolved = resolveDpapiScriptPath({
      repositoryRoot,
      dataRoot: "C:\\ProgramData\\HamdFoodsERP",
      cwd: "C:\\Program Files\\HamdFoodsERP\\app",
    });
    expect(resolved).toBe("C:\\Program Files\\HamdFoodsERP\\windows\\Dpapi-HamdFoodsERP.ps1");
  });
});

describe("DPAPI protect/unprotect (live Windows bridge)", () => {
  const scriptPath = path.join(repositoryRoot, "installer", "scripts", "Dpapi-HamdFoodsERP.ps1");

  windowsIt("round-trips arbitrary bytes through LocalMachine protection", () => {
    const plaintext = Buffer.from("hamd-foods-erp-license-integrity-key-test", "utf8").toString(
      "base64",
    );
    const protectedBlob = dpapiProtect(plaintext, scriptPath);
    expect(protectedBlob).not.toBe(plaintext);
    const recovered = dpapiUnprotect(protectedBlob, scriptPath);
    expect(recovered).toBe(plaintext);
  });

  windowsIt("rejects a corrupted protected blob", () => {
    const plaintext = Buffer.from("test-value", "utf8").toString("base64");
    const protectedBlob = dpapiProtect(plaintext, scriptPath);
    const corrupted = Buffer.from(protectedBlob, "base64");
    corrupted[0] = corrupted[0]! ^ 0xff;
    expect(() => dpapiUnprotect(corrupted.toString("base64"), scriptPath)).toThrow();
  });
});
