export type CommandResult = { exitCode: number; stdout: string; stderr: string };
export type CommandRunner = (executable: string, args: string[]) => CommandResult;
export type NetworkListener = { localAddress: string; localPort: number };
export const ERP_LOCAL_TARGET = "http://127.0.0.1:3100";

export function parseTailscaleStatusJson(json: string): {
  connected: boolean;
  dnsName: string | undefined;
  ipv4: string | undefined;
} {
  const value = parseJsonObject(json, "Tailscale status");
  const self = asObject(value.Self);
  const dnsName = typeof self?.DNSName === "string" ? normalizeDnsName(self.DNSName) : undefined;
  const addresses = Array.isArray(self?.TailscaleIPs) ? self.TailscaleIPs : [];
  const ipv4 = addresses.find(
    (address): address is string => typeof address === "string" && isTailscaleIpv4(address),
  );
  return {
    connected: value.BackendState === "Running" && self?.Online === true,
    dnsName,
    ipv4,
  };
}

export function parseServeStatusJson(
  json: string,
  dnsName: string,
): { enabled: boolean; funnelEnabled: boolean; localTarget: string | undefined } {
  const value = parseJsonObject(json, "Tailscale Serve status");
  const normalizedDnsName = requireTailscaleDnsName(dnsName);
  const authority = `${normalizedDnsName}:443`;
  const web = asObject(value.Web);
  const host = asObject(web?.[authority] ?? web?.[normalizedDnsName]);
  const handlers = asObject(host?.Handlers);
  const rootHandler = asObject(handlers?.["/"]);
  const localTarget = typeof rootHandler?.Proxy === "string" ? rootHandler.Proxy : undefined;
  const tcp = asObject(value.TCP);
  const https = asObject(tcp?.["443"])?.HTTPS === true;
  const allowFunnel = asObject(value.AllowFunnel);
  return {
    enabled: https && localTarget === ERP_LOCAL_TARGET,
    funnelEnabled: allowFunnel?.[authority] === true || allowFunnel?.[normalizedDnsName] === true,
    localTarget,
  };
}

export function buildServeConfigureArgs(): string[] {
  return ["serve", "--bg", "--yes", "--https=443", "--set-path=/", ERP_LOCAL_TARGET];
}

export function buildServeDisableArgs(): string[] {
  return ["serve", "--https=443", "--set-path=/", "off"];
}

export function invokeServeConfigure(run: CommandRunner, cliPath: string): CommandResult {
  return run(cliPath, buildServeConfigureArgs());
}

export function validateNetworkListeners(listeners: NetworkListener[]): {
  erpLoopbackOnly: boolean;
  postgresLoopbackOnly: boolean;
} {
  const erpListeners = listeners.filter((listener) => listener.localPort === 3100);
  if (
    erpListeners.length === 0 ||
    erpListeners.some((listener) => listener.localAddress !== "127.0.0.1")
  )
    throw new Error("ERP port 3100 must listen only on 127.0.0.1.");

  const postgresListeners = listeners.filter((listener) => listener.localPort === 5432);
  if (
    postgresListeners.length === 0 ||
    postgresListeners.some((listener) => !isLoopbackAddress(listener.localAddress))
  )
    throw new Error("PostgreSQL port 5432 must listen only on loopback addresses.");

  return { erpLoopbackOnly: true, postgresLoopbackOnly: true };
}

export function buildRemoteHttpsUrl(dnsName: string): string {
  return `https://${requireTailscaleDnsName(dnsName)}`;
}

export function parseUnattendedPreferencesJson(json: string): boolean | undefined {
  const value = parseJsonObject(json, "Tailscale preferences");
  return typeof value.ForceDaemon === "boolean" ? value.ForceDaemon : undefined;
}

export function validateOriginConfiguration(
  environment: { BETTER_AUTH_URL: string; BETTER_AUTH_TRUSTED_ORIGINS: string[] },
  remoteUrl: string,
): void {
  if (new URL(environment.BETTER_AUTH_URL).origin !== ERP_LOCAL_TARGET)
    throw new Error(
      "BETTER_AUTH_URL must remain http://127.0.0.1:3100 for local maintenance compatibility.",
    );
  if (!environment.BETTER_AUTH_TRUSTED_ORIGINS.includes(remoteUrl))
    throw new Error("BETTER_AUTH_TRUSTED_ORIGINS must include this node's exact HTTPS origin.");
}

export function createSafeRemoteStatus(input: {
  installed: boolean;
  serviceAvailable: boolean;
  connected: boolean;
  dnsName?: string | undefined;
  ipv4?: string | undefined;
  unattended?: boolean | undefined;
  serveEnabled: boolean;
  serveUrl?: string | undefined;
  localTarget?: string | undefined;
  funnelEnabled: boolean;
  localHealth: boolean;
  remoteHealth?: boolean | undefined;
}): string {
  const state = (value: boolean | undefined) =>
    value === undefined ? "NOT AVAILABLE" : value ? "PASS" : "FAIL";
  return [
    "Remote Access: TAILNET PRIVATE",
    `Tailscale Installed: ${state(input.installed)}`,
    `Tailscale Service: ${state(input.serviceAvailable)}`,
    `Tailscale Connected: ${state(input.connected)}`,
    `Tailscale DNS Name: ${input.dnsName ?? "NOT AVAILABLE"}`,
    `Tailscale IPv4: ${input.ipv4 ?? "NOT AVAILABLE"}`,
    `Windows Unattended: ${state(input.unattended)}`,
    `Serve Enabled: ${state(input.serveEnabled)}`,
    `Serve HTTPS URL: ${input.serveUrl ?? "NOT AVAILABLE"}`,
    `Local Target: ${input.localTarget ?? "NOT AVAILABLE"}`,
    `Funnel Disabled: ${state(!input.funnelEnabled)}`,
    `ERP Local Health: ${state(input.localHealth)}`,
    `Tailscale Remote Health: ${state(input.remoteHealth)}`,
  ].join("\n");
}

function parseJsonObject(json: string, label: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(json);
    const object = asObject(value);
    if (!object) throw new Error();
    return object;
  } catch {
    throw new Error(`${label} JSON is invalid.`);
  }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function normalizeDnsName(value: string) {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function requireTailscaleDnsName(value: string) {
  const dnsName = normalizeDnsName(value);
  if (value.includes("://") || value.includes("*") || !isTailscaleDnsName(dnsName))
    throw new Error("Tailscale DNS name must be an exact *.ts.net hostname.");
  return dnsName;
}

function isTailscaleDnsName(value: string) {
  const labels = value.split(".");
  return (
    labels.length > 2 &&
    labels.at(-2) === "ts" &&
    labels.at(-1) === "net" &&
    labels.slice(0, -2).every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  );
}

function isTailscaleIpv4(value: string) {
  const octets = value.split(".").map(Number);
  return (
    octets.length === 4 &&
    octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) &&
    octets[0] === 100 &&
    octets[1]! >= 64 &&
    octets[1]! <= 127
  );
}

function isLoopbackAddress(value: string) {
  return value === "127.0.0.1" || value === "::1" || value === "[::1]";
}
