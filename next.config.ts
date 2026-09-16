import type { NextConfig } from "next";

// Phase 35 M3: this app never uses next/image (confirmed: no `next/image`
// import and no `images` config existed anywhere in src/) -- disabling the
// Image Optimization API removes an entire unauthenticated, pre-auth route
// (/_next/image) that provides this product zero value, independent of and
// in addition to the Phase 35 C1 Next.js version patch.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  // Harmless on the mandated loopback-HTTP origin (browsers only ever act on
  // this header over HTTPS); meaningfully strengthens the optional Tailscale
  // HTTPS origin (docs/operations/tailscale-private-access.md).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    // Enforced (Phase 35 design D2). A bare `default-src 'self'` broke the
    // app entirely in the full E2E suite, for two structural, non-optional
    // reasons discovered from the actual browser console violations (not
    // guessed at):
    //   1. script-src: the App Router delivers each page's RSC payload
    //      through inline `<script>self.__next_f.push([...])</script>` tags
    //      injected by Next's own renderer (not by this app's markup, which
    //      is why grepping src/ for inline scripts found nothing) -- every
    //      page needs 'unsafe-inline' for this, in development and
    //      production alike. 'unsafe-eval' is separately required only by
    //      React's *development*-mode debugging instrumentation (the
    //      violation message says so explicitly: "React will never use
    //      eval() in production mode") -- kept anyway rather than making
    //      this policy environment-conditional, because 'unsafe-inline' for
    //      scripts already permits arbitrary injected-script execution, so
    //      also allowing eval() grants no meaningfully new capability to an
    //      attacker who doesn't already have that.
    //   2. style-src: interactive UI primitives (dropdowns/comboboxes/
    //      tooltips) apply computed positioning via inline style, which is
    //      itself a CSP-checked action, not just static markup -- 'unsafe-
    //      inline' is required for style-src for the same reason.
    // Rejected nonce-based middleware for either as the "major rendering
    // architecture change" Phase 35 D2 says not to force solely for CSP.
    key: "Content-Security-Policy",
    value:
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  output: "standalone",
  reactStrictMode: true,
  images: { unoptimized: true },
  // esbuild ships platform-specific native binaries (@esbuild/win32-x64/
  // esbuild.exe) that the bundler cannot trace. It is only ever invoked by
  // src/server/updates/verify-update-package-file.ts's dev/test-only
  // on-demand orchestrator bundle (never reached in a real production
  // install, which always has HAMDFOODS_DATA_ROOT set) -- excluding it
  // from server bundling keeps it a normal runtime require() instead.
  serverExternalPackages: ["esbuild"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
