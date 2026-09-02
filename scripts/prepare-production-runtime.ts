import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const criticalRuntimeDependencies = ["next", "react", "react-dom"] as const;

export function prepareProductionRuntime(root = repositoryRoot) {
  const standaloneDirectory = path.join(root, ".next", "standalone");
  const publicDirectory = path.join(root, "public");
  const staticDirectory = path.join(root, ".next", "static");

  if (!existsSync(standaloneDirectory))
    throw new Error("Next standalone output is missing. Run the production build first.");
  if (!existsSync(publicDirectory)) throw new Error("The public directory is missing.");
  if (!existsSync(staticDirectory))
    throw new Error("Next static output is missing. Run the production build first.");

  cpSync(publicDirectory, path.join(standaloneDirectory, "public"), {
    recursive: true,
    force: true,
  });
  mkdirSync(path.join(standaloneDirectory, ".next"), { recursive: true });
  cpSync(staticDirectory, path.join(standaloneDirectory, ".next", "static"), {
    recursive: true,
    force: true,
  });
  validateStandaloneDependencies(standaloneDirectory);
}

export function validateStandaloneDependencies(standaloneDirectory: string) {
  const runtimeEntry = path.join(standaloneDirectory, "server.js");
  if (!existsSync(runtimeEntry)) throw new Error("Next standalone server.js is missing.");

  const runtimeRoot = realpathSync(standaloneDirectory);
  const runtimeRequire = createRequire(runtimeEntry);
  const resolutions = {} as Record<(typeof criticalRuntimeDependencies)[number], string>;

  for (const dependency of criticalRuntimeDependencies) {
    let realPackagePath: string;
    try {
      const resolvedPackage = runtimeRequire.resolve(`${dependency}/package.json`);
      realPackagePath = realpathSync(resolvedPackage);
    } catch {
      throw new Error(
        `Native standalone runtime cannot resolve ${dependency} from inside .next/standalone. Cleanly reinstall dependencies with the hoisted pnpm layout and rebuild.`,
      );
    }

    if (!isInsideDirectory(runtimeRoot, realPackagePath))
      throw new Error(
        `Native standalone runtime resolves ${dependency} outside .next/standalone. Cleanly reinstall dependencies with the hoisted pnpm layout and rebuild.`,
      );
    resolutions[dependency] = realPackagePath;
  }

  return resolutions;
}

function isInsideDirectory(root: string, target: string) {
  const relative = path.relative(root, target);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareProductionRuntime();
  console.log("Native standalone runtime prepared.");
}
