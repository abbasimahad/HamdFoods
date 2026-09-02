import { cpSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareProductionRuntime();
  console.log("Native standalone runtime prepared.");
}
