# Tailscale private remote access

Phase 31 adds Tailscale Serve as an optional private HTTPS ingress to the existing native Windows deployment. It does not change local application or database hosting:

```text
authorized phone or laptop
  -> Tailscale encrypted tailnet, HTTPS 443
  -> Tailscale Serve on the factory server
  -> http://127.0.0.1:3100
  -> Hamd Foods ERP
  -> PostgreSQL on loopback port 5432 only
```

The remote URL is `https://<device>.<tailnet>.ts.net` and is **TAILNET PRIVATE**, not public internet access. Tailscale Serve terminates a normally validated HTTPS certificate and proxies to loopback. Tailscale Funnel is prohibited because Funnel makes a service public. Never use `tailscale funnel`, router port forwarding, UPnP, Cloudflare Tunnel, ngrok, a LAN/Tailscale bind for port 3100, or a non-loopback PostgreSQL bind.

Tailscale supplies only the private network perimeter. Better Auth remains the ERP authentication and session authority, and existing ERP RBAC remains authoritative after sign-in. Do not trust `Tailscale-User-Login`, `Tailscale-User-Name`, or other proxy identity headers as ERP authorization.

## Prerequisites and Windows unattended mode

Install the current official Tailscale Windows client manually from [Tailscale's Windows download](https://tailscale.com/download/windows). Phase 31 does not download or install third-party binaries. Sign the factory server into the intended tailnet, enable MagicDNS/HTTPS as required by the tailnet, and confirm the Windows `Tailscale` service is running.

The server must remain connected after logout and restart. From an elevated shell, enable the official Windows unattended mode without resetting any other setting:

```powershell
tailscale up --unattended=true
```

Never add `--reset`. Do not change exit-node selection, advertise routes, advertise an exit node, or enable Tailscale SSH. The production preflight reads `tailscale debug prefs` where available and fails with the exact manual unattended command when it cannot confirm system operation.

## Configure exact Better Auth origins

Keep `HOSTNAME=127.0.0.1`, `PORT=3100`, the loopback PostgreSQL URL, and the loopback Better Auth base URL unchanged. Discover the server's exact DNS name with machine-readable `tailscale status --json`; do not guess or hardcode it. In the ignored, ACL-protected `.env.production`, add the exact HTTPS Serve origin:

```dotenv
BETTER_AUTH_URL=http://127.0.0.1:3100
BETTER_AUTH_TRUSTED_ORIGINS=https://REPLACE_WITH_DEVICE.REPLACE_WITH_TAILNET.ts.net
```

The application accepts exact origins only. The non-loopback origin must be HTTPS on a concrete `*.ts.net` hostname; wildcard, malformed, credential-bearing, path-bearing, public HTTP, non-tailnet HTTPS, and non-443 origins are rejected. Keeping the static Better Auth base URL on loopback preserves direct HTTP maintenance sessions; the exact trusted origin admits the HTTPS proxy origin without changing authentication authority. Never print or commit the real environment file, and restart only the existing `HamdFoodsERP` task after changing it.

## Preflight, enable, status, health, and disable

Start with the existing local production service healthy. Run from an elevated repository shell:

```powershell
corepack pnpm production:health
corepack pnpm production:remote:preflight
corepack pnpm production:remote:configure
corepack pnpm production:remote:status
corepack pnpm production:remote:health
```

Remote preflight requires all of the following before any Serve change: local health, ERP listening only on `127.0.0.1:3100`, PostgreSQL listening only on loopback port 5432, installed/running Tailscale, connected local node, exact DNS name, Tailscale IPv4, confirmed unattended mode, exact Better Auth origins, and no Funnel exposure. Status emits only non-secret local-node facts and clearly separates local health from remote HTTPS health.

Configure uses the current persistent Serve form equivalent to:

```powershell
tailscale serve --bg --yes --https=443 --set-path=/ http://127.0.0.1:3100
```

It does not start another Node process or alter the `HamdFoodsERP` task. It refuses to overwrite an existing HTTPS root belonging to another target. Normal TLS verification is mandatory for remote health; never use `-k`, `--insecure`, `https+insecure`, or `NODE_TLS_REJECT_UNAUTHORIZED=0`.

Disable only the root handler created for the ERP:

```powershell
corepack pnpm production:remote:disable
```

The implementation uses the selective `tailscale serve --https=443 --set-path=/ off` form. It never runs `tailscale serve reset`, and it refuses removal if the root belongs to another target. Verify status afterward. Other Serve paths/services must remain untouched.

## Least-privilege tailnet Grants

Merge an example like this into the existing tailnet policy; never replace the entire policy automatically:

```json
{
  "groups": {
    "group:hamd-erp-users": ["REPLACE_WITH_AUTHORIZED_TAILSCALE_USER"]
  },
  "tagOwners": {
    "tag:hamd-erp-server": ["autogroup:admin"]
  },
  "grants": [
    {
      "src": ["group:hamd-erp-users"],
      "dst": ["tag:hamd-erp-server"],
      "ip": ["tcp:443"]
    }
  ]
}
```

This follows the current [Tailscale Grants syntax](https://tailscale.com/docs/reference/examples/grants). Apply `tag:hamd-erp-server` to the factory server using the tailnet's normal administrative process. Do not grant this group port 3100, port 5432, all ports, `*`, subnet routing, exit-node access, or SSH. Review and remove any broad default allow-all Grant/ACL that would independently permit the same users wider access; Grants are additive.

Add an authorized user by adding their exact Tailscale identity to `group:hamd-erp-users`, reviewing the policy diff, and applying it through the Tailscale admin console. Remove access by deleting the identity from the group. For a lost or stolen phone, immediately expire/remove the device in the admin console, remove the user from the ERP group when appropriate, revoke active ERP sessions or disable the ERP user, and review audit logs. No Tailscale API/auth key belongs in this repository.

## Phone/laptop acceptance gate

The operator deferred this real second-device gate to final project UAT. Server implementation is complete; the following checks remain mandatory at final UAT and must not be fabricated:

1. Install the official Tailscale client and sign into an authorized tailnet identity.
2. Prefer mobile data or another off-factory network instead of factory Wi-Fi.
3. Open the generated HTTPS `*.ts.net` ERP URL and confirm a valid certificate.
4. Confirm `/login`, Better Auth sign-in, `/dashboard`, inventory, purchasing, production, sales, logout, and a second login.
5. Confirm `/manifest.webmanifest`, `/sw.js`, and `/offline.html` load from the same HTTPS origin and the PWA can be installed.
6. From an unauthorized tailnet user/device, confirm the ERP cannot be reached after the least-privilege Grant is active.
7. Without Tailscale connectivity, confirm the URL is not reachable from the public internet.

The same responsive ERP PWA is used remotely; there is no separate mobile application. Its service worker uses the current origin and does not contain a hardcoded loopback URL.

## Persistence and local fallback

Serve `--bg` state is persistent in Tailscale. After configuration, a safe operator maintenance test may restart only the Tailscale service and then rerun remote status/health; do not reboot Windows automatically. Record an actual post-reboot remote-device check during the next planned server restart.

Tailscale failure must not stop local ERP operation. If the internet, control plane, or Tailscale service is unavailable, use `http://127.0.0.1:3100` on the factory server. The `HamdFoodsERP` Scheduled Task, PostgreSQL, production health, and backup/recovery commands have no Tailscale dependency.

## Troubleshooting

- **Tailscale not installed:** install the official Windows client manually; no repository command installs it.
- **Service or connection unavailable:** inspect the official client and `tailscale status --json`; do not reset settings.
- **Unattended not confirmed:** from an elevated shell run `tailscale up --unattended=true` without `--reset`.
- **DNS name unavailable:** verify the node is signed in, connected, and MagicDNS/HTTPS are available in the tailnet.
- **Origin mismatch:** keep `BETTER_AUTH_URL=http://127.0.0.1:3100`, add the exact discovered HTTPS URL to `BETTER_AUTH_TRUSTED_ORIGINS`, restart the ERP task, and rerun both local and remote preflight.
- **Unsafe listener:** restore Next.js to `127.0.0.1:3100` and PostgreSQL to loopback port 5432 before continuing. Never open Windows Firewall for those ports.
- **Conflicting Serve root:** inspect `tailscale serve status --json` and coordinate with the owner; the ERP command will not overwrite or reset it.
- **Funnel detected:** treat it as a security incident, disable the relevant public exposure through approved Tailscale administration, and do not configure ERP Serve until preflight passes.
- **Remote health fails while local health passes:** investigate the Tailscale service, tailnet Grant, DNS, and certificate state. Do not weaken TLS verification.
