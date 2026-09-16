import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  output: "standalone",
  reactStrictMode: true,
  // esbuild ships platform-specific native binaries (@esbuild/win32-x64/
  // esbuild.exe) that the bundler cannot trace. It is only ever invoked by
  // src/server/updates/verify-update-package-file.ts's dev/test-only
  // on-demand orchestrator bundle (never reached in a real production
  // install, which always has HAMDFOODS_DATA_ROOT set) -- excluding it
  // from server bundling keeps it a normal runtime require() instead.
  serverExternalPackages: ["esbuild"],
};

export default nextConfig;
