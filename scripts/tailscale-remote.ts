import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { config } from "dotenv";

import { parseNativeProductionEnv, type NativeProductionEnv } from "../src/server/env";
import {
  buildRemoteHttpsUrl,
  buildServeDisableArgs,
  createSafeRemoteStatus,
  ERP_LOCAL_TARGET,
  invokeServeConfigure,
  parseServeStatusJson,
  parseTailscaleStatusJson,
  parseUnattendedPreferencesJson,
  validateOriginConfiguration,
  validateNetworkListeners,
  type CommandResult,
  type NetworkListener,
} from "../src/server/operations/tailscale-remote";
import { resolveProductionEnvFile } from "../src/server/operations/windows-installer";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const action = process.argv[2];

try {
  if (process.platform !== "win32")
    throw new Error("Tailscale production integration is supported only on Windows.");

  const environment = loadProductionEnvironment();
  switch (action) {
    case "preflight":
      await remotePreflight(environment);
      break;
    case "configure":
      await configureRemoteAccess(environment);
      break;
    case "status":
      await showRemoteStatus(environment);
      break;
    case "health":
      await checkRemoteHealth(environment);
      break;
    case "disable":
      await disableRemoteAccess(environment);
      break;
    default:
      throw new Error("Usage: tailscale-remote.ts <preflight|configure|status|health|disable>.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Tailscale remote command failed.");
  process.exitCode = 1;
}

function loadProductionEnvironment() {
  const productionEnvPath = resolveProductionEnvFile({
    repositoryRoot,
    configuredPath: process.env.HAMDFOODS_ENV_FILE,
    dataRoot: process.env.HAMDFOODS_DATA_ROOT,
    programDataRoot: process.env.ProgramData,
  });
  if (!existsSync(productionEnvPath))
    throw new Error(`Protected production configuration is missing at ${productionEnvPath}.`);
  const result = config({ path: productionEnvPath, quiet: true, override: true });
  if (result.error) throw new Error(".env.production could not be loaded.");
  return parseNativeProductionEnv(process.env);
}

async function remotePreflight(environment: NativeProductionEnv) {
  const context = await requireRemoteContext(environment);
  console.log(`Tailscale remote preflight passed for ${context.remoteUrl}.`);
}

async function configureRemoteAccess(environment: NativeProductionEnv) {
  const context = await requireRemoteContext(environment);
  if (context.serve.localTarget && context.serve.localTarget !== ERP_LOCAL_TARGET)
    throw new Error(
      "Tailscale HTTPS root already serves another target; refusing to overwrite unrelated configuration.",
    );
  if (context.serve.funnelEnabled)
    throw new Error("Funnel is enabled for HTTPS 443; refusing to configure ERP Serve.");

  if (!context.serve.enabled) {
    const result = invokeServeConfigure(runCommand, context.cliPath);
    if (result.exitCode !== 0) throw new Error("Tailscale Serve configuration failed.");
  }

  const configured = getServeState(context.cliPath, context.status.dnsName!);
  if (!configured.enabled || configured.localTarget !== ERP_LOCAL_TARGET)
    throw new Error("Tailscale Serve did not retain the expected loopback target.");
  if (configured.funnelEnabled)
    throw new Error("Funnel exposure detected after Serve configuration.");
  console.log(`TAILNET PRIVATE Serve configured at ${context.remoteUrl}.`);
}

async function showRemoteStatus(environment: NativeProductionEnv) {
  const listeners = getNetworkListeners();
  validateNetworkListeners(listeners);
  assertDatabasePort(environment.DATABASE_URL);
  const localHealth = await isHealthy(ERP_LOCAL_TARGET);
  const cliPath = discoverTailscaleCli();
  if (!cliPath) {
    console.log(
      createSafeRemoteStatus({
        installed: false,
        serviceAvailable: false,
        connected: false,
        serveEnabled: false,
        funnelEnabled: false,
        localHealth,
      }),
    );
    return;
  }

  const serviceAvailable = isTailscaleServiceRunning();
  if (!serviceAvailable) {
    console.log(
      createSafeRemoteStatus({
        installed: true,
        serviceAvailable: false,
        connected: false,
        serveEnabled: false,
        funnelEnabled: false,
        localHealth,
      }),
    );
    return;
  }
  const status = getTailscaleStatus(cliPath);
  const unattended = getUnattendedState(cliPath);
  const remoteUrl = status.dnsName ? buildRemoteHttpsUrl(status.dnsName) : undefined;
  const serve = status.dnsName
    ? getServeState(cliPath, status.dnsName)
    : { enabled: false, funnelEnabled: false, localTarget: undefined };
  const remoteHealth = remoteUrl ? await isHealthy(remoteUrl) : undefined;
  console.log(
    createSafeRemoteStatus({
      installed: true,
      serviceAvailable,
      connected: status.connected,
      dnsName: status.dnsName,
      ipv4: status.ipv4,
      unattended,
      serveEnabled: serve.enabled,
      serveUrl: remoteUrl,
      localTarget: serve.localTarget,
      funnelEnabled: serve.funnelEnabled,
      localHealth,
      remoteHealth,
    }),
  );
}

async function checkRemoteHealth(environment: NativeProductionEnv) {
  const context = await requireRemoteContext(environment);
  if (!context.serve.enabled)
    throw new Error("Tailscale Serve is not configured for the ERP loopback target.");
  if (!(await isHealthy(context.remoteUrl)))
    throw new Error("Tailscale remote health check failed with normal TLS verification.");
  console.log(`Tailscale remote health check passed for ${context.remoteUrl}.`);
}

async function disableRemoteAccess(environment: NativeProductionEnv) {
  const context = await requireRemoteContext(environment, { requireOriginConfiguration: false });
  if (!context.serve.localTarget) {
    console.log("ERP Tailscale Serve root is already disabled.");
    return;
  }
  if (context.serve.localTarget !== ERP_LOCAL_TARGET)
    throw new Error(
      "Tailscale HTTPS root belongs to another target; refusing to remove unrelated configuration.",
    );
  const result = runCommand(context.cliPath, buildServeDisableArgs());
  if (result.exitCode !== 0) throw new Error("Selective ERP Serve disable failed.");
  const disabled = getServeState(context.cliPath, context.status.dnsName!);
  if (disabled.localTarget)
    throw new Error("ERP Serve root remains configured after the selective disable command.");
  console.log("ERP Tailscale Serve root disabled; unrelated Serve configuration was not reset.");
}

async function requireRemoteContext(
  environment: NativeProductionEnv,
  options: { requireOriginConfiguration?: boolean } = {},
) {
  validateNetworkListeners(getNetworkListeners());
  assertDatabasePort(environment.DATABASE_URL);
  if (!(await isHealthy(ERP_LOCAL_TARGET)))
    throw new Error("Local ERP health failed; Tailscale remote access was not changed.");

  const cliPath = discoverTailscaleCli();
  if (!cliPath)
    throw new Error(
      "Tailscale is not installed. Install the official Windows client, sign in, and enable Run Unattended before configuring remote access.",
    );
  if (!isTailscaleServiceRunning())
    throw new Error("The Windows Tailscale service is not running.");

  const status = getTailscaleStatus(cliPath);
  if (!status.connected) throw new Error("Tailscale is not connected.");
  if (!status.dnsName) throw new Error("Tailscale did not report a DNS name for this node.");
  if (!status.ipv4) throw new Error("Tailscale did not report an IPv4 address for this node.");
  const unattended = getUnattendedState(cliPath);
  if (unattended !== true)
    throw new Error(
      "Windows Run Unattended is not confirmed. From an elevated shell run: tailscale up --unattended=true (without --reset), then rerun preflight.",
    );

  const remoteUrl = buildRemoteHttpsUrl(status.dnsName);
  if (options.requireOriginConfiguration !== false)
    validateOriginConfiguration(environment, remoteUrl);
  const serve = getServeState(cliPath, status.dnsName);
  if (serve.funnelEnabled)
    throw new Error("Funnel exposure is enabled for the ERP HTTPS endpoint.");
  return { cliPath, status, remoteUrl, serve };
}

function discoverTailscaleCli() {
  const candidates = [
    ...splitPath(process.env.PATH).map((directory) => path.join(directory, "tailscale.exe")),
    path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Tailscale", "tailscale.exe"),
    path.join(
      process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
      "Tailscale IPN",
      "tailscale.exe",
    ),
  ];
  return candidates.find(
    (candidate, index) => candidates.indexOf(candidate) === index && existsSync(candidate),
  );
}

function splitPath(value: string | undefined) {
  return value
    ? value.split(path.delimiter).map((entry) => entry.trim().replace(/^"|"$/g, ""))
    : [];
}

function isTailscaleServiceRunning() {
  const result = runCommand("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "if ((Get-Service -Name Tailscale -ErrorAction SilentlyContinue).Status -eq 'Running') { exit 0 } else { exit 1 }",
  ]);
  return result.exitCode === 0;
}

function getTailscaleStatus(cliPath: string) {
  const result = runCommand(cliPath, ["status", "--json"]);
  if (result.exitCode !== 0) throw new Error("Tailscale status is unavailable.");
  return parseTailscaleStatusJson(result.stdout);
}

function getServeState(cliPath: string, dnsName: string) {
  const result = runCommand(cliPath, ["serve", "status", "--json"]);
  if (result.exitCode !== 0) throw new Error("Tailscale Serve status is unavailable.");
  return parseServeStatusJson(result.stdout || "{}", dnsName);
}

function getUnattendedState(cliPath: string) {
  const result = runCommand(cliPath, ["debug", "prefs"]);
  if (result.exitCode !== 0 || !result.stdout.trim()) return undefined;
  try {
    return parseUnattendedPreferencesJson(result.stdout);
  } catch {
    return undefined;
  }
}

function getNetworkListeners(): NetworkListener[] {
  const command =
    "@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -in 3100,5432 } | Select-Object LocalAddress,LocalPort) | ConvertTo-Json -Compress";
  const result = runCommand("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    command,
  ]);
  if (result.exitCode !== 0) throw new Error("Windows listener inspection failed.");
  const parsed: unknown = JSON.parse(result.stdout || "[]");
  const values = Array.isArray(parsed) ? parsed : [parsed];
  return values.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.LocalAddress !== "string" || typeof candidate.LocalPort !== "number")
      return [];
    return [{ localAddress: candidate.LocalAddress, localPort: candidate.LocalPort }];
  });
}

function assertDatabasePort(databaseUrl: string) {
  const url = new URL(databaseUrl);
  if ((url.port || "5432") !== "5432")
    throw new Error("Production PostgreSQL must use loopback port 5432 for remote-access checks.");
}

async function isHealthy(origin: string) {
  try {
    const response = await fetch(`${origin}/api/health`, { redirect: "error" });
    const body: unknown = await response.json().catch(() => undefined);
    return (
      response.status === 200 &&
      Boolean(body && typeof body === "object" && "status" in body && body.status === "ok")
    );
  } catch {
    return false;
  }
}

function runCommand(executable: string, args: string[]): CommandResult {
  const result = spawnSync(executable, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    exitCode: result.status ?? (result.error ? 1 : 0),
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
