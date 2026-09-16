import { spawnSync } from "node:child_process";
import path from "node:path";

export type StartUpdateTaskResult = { ok: boolean; message: string };

/**
 * Starts the SYSTEM-identity, trigger-less HamdFoodsERP-Update Scheduled
 * Task via schtasks.exe. The web application process already runs under
 * the same SYSTEM identity as the main HamdFoodsERP task (see
 * Register-ApplicationTask in Setup-HamdFoodsERP.ps1), so no elevation
 * prompt or credential is needed here -- this is a same-privilege sibling
 * task start, not a privilege escalation.
 */
export function startUpdateTask(taskName: string): StartUpdateTaskResult {
  if (process.platform !== "win32") {
    return { ok: false, message: "Scheduled Task control is only available on win32." };
  }
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const schtasks = path.join(systemRoot, "System32", "schtasks.exe");
  const result = spawnSync(schtasks, ["/Run", "/TN", taskName], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000,
  });
  if (result.error)
    return { ok: false, message: `Could not start the update task: ${result.error.message}` };
  if (result.status !== 0) {
    return {
      ok: false,
      message: (result.stdout || result.stderr || "Update task could not be started.").trim(),
    };
  }
  return { ok: true, message: "Update task started." };
}
