/**
 * INST-3: which build is running. The values are inlined by next.config.ts at build time (from
 * package.json and the git commit of the source tree), so the installed app can always say
 * exactly what was installed, independent of the installer file name.
 */
export const BUILD_INFO = {
  version: process.env.HAMDFOODS_APP_VERSION || "dev",
  commit: process.env.HAMDFOODS_BUILD_COMMIT || "unknown",
  builtAt: process.env.HAMDFOODS_BUILD_TIME || "",
} as const;

export function buildLabel() {
  return `v${BUILD_INFO.version} · build ${BUILD_INFO.commit}`;
}
