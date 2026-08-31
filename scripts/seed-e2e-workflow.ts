import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { e2eStatePath } from "../e2e/state";
import { prisma } from "../src/server/db/prisma";
import { executePhase27GoldenWorkflow } from "../src/test/phase27-golden-workflow";

const state = await executePhase27GoldenWorkflow();
mkdirSync(path.dirname(e2eStatePath), { recursive: true });
writeFileSync(e2eStatePath, JSON.stringify(state, null, 2), "utf8");
await prisma.$disconnect();
console.log(`Phase 27 E2E workflow fixture ready at ${e2eStatePath}.`);
