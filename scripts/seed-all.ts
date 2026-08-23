import { seedAccessControl } from "../src/modules/access/application/seed-access-control";
import { seedMasterData } from "../src/modules/master-data/application/seed-master-data";
import { PrismaAccessRepository } from "../src/server/access/prisma-access-repository";
import { PrismaMasterDataRepository } from "../src/server/master-data/prisma-master-data-repository";

await seedAccessControl(new PrismaAccessRepository());
const result = await seedMasterData(new PrismaMasterDataRepository());
console.log(
  `Access policy and master data synchronized: ${result.units} units and ${result.categories} categories.`,
);
