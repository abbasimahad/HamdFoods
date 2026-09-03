import { describe, expect, it, vi } from "vitest";

import {
  buildRemoteHttpsUrl,
  buildServeConfigureArgs,
  buildServeDisableArgs,
  createSafeRemoteStatus,
  invokeServeConfigure,
  parseServeStatusJson,
  parseTailscaleStatusJson,
  parseUnattendedPreferencesJson,
  validateOriginConfiguration,
  validateNetworkListeners,
} from "./tailscale-remote";

const dnsName = "factory-server.example-tailnet.ts.net";
const localTarget = "http://127.0.0.1:3100";

describe("Tailscale remote access", () => {
  it("parses connected local-node status without retaining identity fields", () => {
    // Defect caught: status parsing could accept an offline node or leak user/account state.
    const status = parseTailscaleStatusJson(
      JSON.stringify({
        BackendState: "Running",
        Self: {
          Online: true,
          DNSName: `${dnsName}.`,
          TailscaleIPs: ["100.100.101.102", "fd7a:115c:a1e0::1"],
          UserID: 42,
        },
        User: { 42: { LoginName: "owner@example.com", AuthKey: "tskey-secret" } },
      }),
    );

    expect(status).toEqual({ connected: true, dnsName, ipv4: "100.100.101.102" });
    expect(JSON.stringify(status)).not.toContain("owner@example.com");
    expect(JSON.stringify(status)).not.toContain("tskey-secret");
  });

  it("distinguishes a disconnected node", () => {
    // Defect caught: a stale local identity could be reported as remotely reachable.
    expect(
      parseTailscaleStatusJson(
        JSON.stringify({
          BackendState: "Stopped",
          Self: {
            Online: false,
            DNSName: `${dnsName}.`,
            TailscaleIPs: ["100.100.101.102"],
          },
        }),
      ),
    ).toEqual({ connected: false, dnsName, ipv4: "100.100.101.102" });
  });

  it("parses the exact ERP Serve target and detects Funnel", () => {
    // Defect caught: public Funnel exposure could be mistaken for private Serve.
    const privateServe = JSON.stringify({
      TCP: { "443": { HTTPS: true } },
      Web: {
        [`${dnsName}:443`]: { Handlers: { "/": { Proxy: localTarget } } },
      },
      AllowFunnel: { [`${dnsName}:443`]: false },
    });
    const publicServe = JSON.stringify({
      TCP: { "443": { HTTPS: true } },
      Web: {
        [`${dnsName}:443`]: { Handlers: { "/": { Proxy: localTarget } } },
      },
      AllowFunnel: { [`${dnsName}:443`]: true },
    });

    expect(parseServeStatusJson(privateServe, dnsName)).toEqual({
      enabled: true,
      funnelEnabled: false,
      localTarget,
    });
    expect(parseServeStatusJson(publicServe, dnsName).funnelEnabled).toBe(true);
  });

  it("builds persistent configure and selective root-disable commands", () => {
    // Defect caught: configuration could start a foreground proxy or reset unrelated Serve mounts.
    expect(buildServeConfigureArgs()).toEqual([
      "serve",
      "--bg",
      "--yes",
      "--https=443",
      "--set-path=/",
      localTarget,
    ]);
    expect(buildServeDisableArgs()).toEqual(["serve", "--https=443", "--set-path=/", "off"]);
  });

  it("executes configuration through the injected command boundary", () => {
    // Defect caught: the production command could invoke Funnel or target a non-loopback address.
    const run = vi.fn(() => ({ exitCode: 0, stdout: "configured", stderr: "" }));

    expect(invokeServeConfigure(run, "C:\\Program Files\\Tailscale\\tailscale.exe")).toEqual({
      exitCode: 0,
      stdout: "configured",
      stderr: "",
    });
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith("C:\\Program Files\\Tailscale\\tailscale.exe", [
      "serve",
      "--bg",
      "--yes",
      "--https=443",
      "--set-path=/",
      localTarget,
    ]);
  });

  it("accepts only the exact loopback ERP and PostgreSQL listeners", () => {
    // Defect caught: direct LAN or tailnet listeners could bypass HTTPS Serve.
    expect(
      validateNetworkListeners([
        { localAddress: "127.0.0.1", localPort: 3100 },
        { localAddress: "::1", localPort: 5432 },
      ]),
    ).toEqual({ erpLoopbackOnly: true, postgresLoopbackOnly: true });

    expect(() =>
      validateNetworkListeners([
        { localAddress: "0.0.0.0", localPort: 3100 },
        { localAddress: "127.0.0.1", localPort: 5432 },
      ]),
    ).toThrowError(/3100/);
    expect(() =>
      validateNetworkListeners([
        { localAddress: "127.0.0.1", localPort: 3100 },
        { localAddress: "100.100.101.102", localPort: 5432 },
      ]),
    ).toThrowError(/5432/);
  });

  it.each([
    ["valid", `${dnsName}.`, `https://${dnsName}`],
    ["wildcard", "*.example-tailnet.ts.net", null],
    ["public", "factory.example.com", null],
    ["malformed", "https://factory.example-tailnet.ts.net", null],
    ["empty label", "factory..example-tailnet.ts.net", null],
  ])("constructs only a valid Tailscale HTTPS URL: %s", (_case, input, expected) => {
    // Defect caught: malformed or public hostnames could become trusted remote URLs.
    if (expected) expect(buildRemoteHttpsUrl(input)).toBe(expected);
    else expect(() => buildRemoteHttpsUrl(input)).toThrowError(/Tailscale DNS/);
  });

  it("detects Windows unattended preferences when the CLI exposes them", () => {
    // Defect caught: session-scoped Tailscale could be reported as reboot-resilient.
    expect(parseUnattendedPreferencesJson('{"ForceDaemon":true}')).toBe(true);
    expect(parseUnattendedPreferencesJson('{"ForceDaemon":false}')).toBe(false);
    expect(parseUnattendedPreferencesJson("{}")).toBeUndefined();
  });

  it("keeps the local Better Auth base URL and trusts only the exact remote origin", () => {
    // Defect caught: making the HTTPS proxy the static base URL forces Secure cookies and breaks HTTP maintenance login.
    expect(() =>
      validateOriginConfiguration(
        {
          BETTER_AUTH_URL: localTarget,
          BETTER_AUTH_TRUSTED_ORIGINS: [`https://${dnsName}`],
        },
        `https://${dnsName}`,
      ),
    ).not.toThrow();
    expect(() =>
      validateOriginConfiguration(
        {
          BETTER_AUTH_URL: `https://${dnsName}`,
          BETTER_AUTH_TRUSTED_ORIGINS: [localTarget],
        },
        `https://${dnsName}`,
      ),
    ).toThrowError(/BETTER_AUTH_URL/);
  });

  it("formats only the non-secret operational status", () => {
    // Defect caught: raw CLI identity or authentication fields could be printed to operators or logs.
    const output = createSafeRemoteStatus({
      installed: true,
      serviceAvailable: true,
      connected: true,
      dnsName,
      ipv4: "100.100.101.102",
      unattended: true,
      serveEnabled: true,
      serveUrl: `https://${dnsName}`,
      localTarget,
      funnelEnabled: false,
      localHealth: true,
      remoteHealth: true,
    });

    expect(output).toContain("TAILNET PRIVATE");
    expect(output).toContain(`Tailscale DNS Name: ${dnsName}`);
    expect(output).not.toMatch(/token|auth.?key|password|owner@example/i);
  });
});
