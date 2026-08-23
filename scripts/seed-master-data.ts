import { seedMasterData } from "../src/modules/master-data/application/seed-master-data";
import { PrismaMasterDataRepository } from "../src/server/master-data/prisma-master-data-repository";

const result = await seedMasterData(new PrismaMasterDataRepository());
console.log(`Master data synchronized: ${result.units} units and ${result.categories} categories.`);
