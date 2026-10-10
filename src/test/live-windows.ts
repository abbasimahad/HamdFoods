import { it, type TestFunction } from "vitest";

/**
 * Live Windows checks spawn real PowerShell, DPAPI and file-system work. Alone each takes about
 * 1-2 s, but the full suite runs test files in parallel and a loaded machine pushed single calls
 * past Vitest's 5 s default, failing correct code. Give them a realistic budget instead.
 */
const LIVE_WINDOWS_TIMEOUT_MS = 30_000;

/** `it` for checks that need real Windows; skipped on other platforms. */
export function windowsIt(name: string, fn: TestFunction, timeout = LIVE_WINDOWS_TIMEOUT_MS) {
  return (process.platform === "win32" ? it : it.skip)(
    name,
    { timeout: Math.max(timeout, LIVE_WINDOWS_TIMEOUT_MS) },
    fn,
  );
}
