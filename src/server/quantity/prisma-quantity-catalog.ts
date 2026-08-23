import "server-only";

import type {
  FinishedGoodCalculatorRecord,
  QuantityCatalog,
  QuantityUnitRecord,
} from "@/modules/quantity/application/contracts";
import {
  isSupportedQuantityUnitCode,
  SUPPORTED_QUANTITY_UNIT_CODES,
  supportedQuantityUnitDimension,
} from "@/modules/quantity/domain/quantity";
import { prisma } from "@/server/db/prisma";

export class PrismaQuantityCatalog implements QuantityCatalog {
  async listActiveSupportedUnits(): Promise<readonly QuantityUnitRecord[]> {
    const units = await prisma.unit.findMany({
      where: { active: true, code: { in: [...SUPPORTED_QUANTITY_UNIT_CODES] } },
      orderBy: [{ dimension: "asc" }, { name: "asc" }],
    });
    return units.filter((unit) => supportedQuantityUnitDimension(unit.code) === unit.dimension);
  }

  async listActiveFinishedGoods() {
    const records = await prisma.item.findMany({
      where: {
        active: true,
        itemType: "FINISHED_GOOD",
        finishedGoodProfile: { isNot: null },
      },
      select: {
        id: true,
        code: true,
        name: true,
        finishedGoodProfile: {
          select: { netContentUnitDimension: true, netContentUnit: true },
        },
      },
      orderBy: { name: "asc" },
      take: 500,
    });
    return records
      .filter((record) => {
        const profile = record.finishedGoodProfile;
        return (
          profile?.netContentUnit.active === true &&
          isSupportedQuantityUnitCode(profile.netContentUnit.code) &&
          supportedQuantityUnitDimension(profile.netContentUnit.code) ===
            profile.netContentUnit.dimension &&
          ["MASS", "VOLUME"].includes(profile.netContentUnitDimension) &&
          profile.netContentUnit.dimension === profile.netContentUnitDimension
        );
      })
      .slice(0, 250)
      .map(({ id, code, name }) => ({ id, code, name }));
  }

  async getActiveUnit(id: string): Promise<QuantityUnitRecord | null> {
    const unit = await prisma.unit.findFirst({
      where: { id, active: true, code: { in: [...SUPPORTED_QUANTITY_UNIT_CODES] } },
    });
    return unit && supportedQuantityUnitDimension(unit.code) === unit.dimension ? unit : null;
  }

  async getActiveFinishedGood(id: string): Promise<FinishedGoodCalculatorRecord | null> {
    const record = await prisma.item.findFirst({
      where: { id, active: true, itemType: "FINISHED_GOOD" },
      select: {
        id: true,
        code: true,
        name: true,
        finishedGoodProfile: {
          select: {
            netContentQuantity: true,
            netContentUnitDimension: true,
            piecesPerCarton: true,
            netContentUnit: true,
          },
        },
      },
    });
    if (
      !record?.finishedGoodProfile ||
      !record.finishedGoodProfile.netContentUnit.active ||
      !isSupportedQuantityUnitCode(record.finishedGoodProfile.netContentUnit.code) ||
      supportedQuantityUnitDimension(record.finishedGoodProfile.netContentUnit.code) !==
        record.finishedGoodProfile.netContentUnit.dimension ||
      !["MASS", "VOLUME"].includes(record.finishedGoodProfile.netContentUnitDimension) ||
      record.finishedGoodProfile.netContentUnit.dimension !==
        record.finishedGoodProfile.netContentUnitDimension
    ) {
      return null;
    }
    return {
      id: record.id,
      code: record.code,
      name: record.name,
      netContentQuantity: record.finishedGoodProfile.netContentQuantity.toString(),
      netContentUnit: record.finishedGoodProfile.netContentUnit,
      netContentUnitDimension: record.finishedGoodProfile.netContentUnitDimension,
      piecesPerCarton: record.finishedGoodProfile.piecesPerCarton,
    };
  }
}
