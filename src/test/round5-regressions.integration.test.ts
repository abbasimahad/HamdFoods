import Decimal from "decimal.js";
import { beforeAll, describe, expect, it } from "vitest";

import {
  decideAccountingPeriodReopen,
  requestAccountingPeriodReopen,
} from "@/server/accounting/period-close";
import { prisma } from "@/server/db/prisma";
import {
  postValuedInbound,
  postValuedOutbound,
} from "@/server/inventory/transactional-inventory-valuation";
import { executePhase27GoldenWorkflow, type Phase27WorkflowState } from "./phase27-golden-workflow";

let state: Phase27WorkflowState;

beforeAll(async () => {
  state = await executePhase27GoldenWorkflow();
});

class Rollback extends Error {}

describe("round-5 bug-log regressions", () => {
  it("BUG-34: valuation amounts are whole paisa and running value stays their exact sum", async () => {
    const observed: { inbound: string; outbound: string; running: string; quantity: string }[] = [];
    await expect(
      prisma.$transaction(async (tx) => {
        const before = await tx.inventoryValuationBalance.findUniqueOrThrow({
          where: { itemId: state.rawItemId },
        });
        const common = {
          itemId: state.rawItemId,
          effectiveAt: new Date(),
          sourceType: "ROUND5_TEST",
          actorUserId: state.actorUserId,
        };
        await postValuedInbound(tx, {
          ...common,
          sourceKey: "ROUND5-BUG34-IN",
          entryType: "ADJUSTMENT_IN",
          quantity: "3",
          unitCost: "1.111111111111",
        });
        await postValuedOutbound(tx, {
          ...common,
          sourceKey: "ROUND5-BUG34-OUT",
          entryType: "ADJUSTMENT_OUT",
          quantity: "1",
        });
        const [inbound, outbound] = await Promise.all(
          ["ROUND5-BUG34-IN", "ROUND5-BUG34-OUT"].map((sourceKey) =>
            tx.inventoryValuationEntry.findUniqueOrThrow({ where: { sourceKey } }),
          ),
        );
        const after = await tx.inventoryValuationBalance.findUniqueOrThrow({
          where: { itemId: state.rawItemId },
        });
        observed.push({
          inbound: inbound!.valueDelta!.toString(),
          outbound: outbound!.valueDelta!.toString(),
          running: new Decimal(after.inventoryValue.toString())
            .sub(before.inventoryValue.toString())
            .toFixed(),
          quantity: new Decimal(after.ownedQuantity.toString())
            .sub(before.ownedQuantity.toString())
            .toFixed(),
        });
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
    const [result] = observed;
    expect(new Decimal(result!.inbound).toFixed()).toBe("3.33");
    expect(new Decimal(result!.outbound).decimalPlaces()).toBeLessThanOrEqual(2);
    expect(result!.running).toBe(new Decimal(result!.inbound).add(result!.outbound).toFixed());
    expect(result!.quantity).toBe("2");
  });

  it("ROLE-3: reopening a closed period needs a second person", async () => {
    const period = await prisma.accountingPeriod.upsert({
      where: { name: "Round 5 reopen control 2001-01" },
      create: {
        name: "Round 5 reopen control 2001-01",
        startDate: new Date("2001-01-01T00:00:00.000Z"),
        endDate: new Date("2001-01-31T00:00:00.000Z"),
        status: "CLOSED",
      },
      update: { status: "CLOSED" },
    });
    const approver = await prisma.user.upsert({
      where: { email: "round5.period.approver@example.test" },
      create: {
        id: "00000000-0000-4000-8000-000000000503",
        name: "Round 5 Period Approver",
        email: "round5.period.approver@example.test",
        emailVerified: true,
      },
      update: { active: true },
    });

    await requestAccountingPeriodReopen(period.id, state.actorUserId, "Late supplier bill found.");
    expect(
      (await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: period.id } })).status,
    ).toBe("CLOSED");
    await expect(
      requestAccountingPeriodReopen(period.id, state.actorUserId, "Second request."),
    ).rejects.toThrow("already awaiting approval");
    await expect(
      decideAccountingPeriodReopen(period.id, state.actorUserId, "APPROVE", ""),
    ).rejects.toThrow("someone other than the requester");

    await decideAccountingPeriodReopen(period.id, approver.id, "APPROVE", "Checked the bill.");
    const reopened = await prisma.accountingPeriod.findUniqueOrThrow({
      where: { id: period.id },
      include: { events: { orderBy: { createdAt: "asc" } } },
    });
    expect(reopened.status).toBe("OPEN");
    expect(reopened.events.map((event) => event.action).slice(-2)).toEqual([
      "REOPEN_REQUESTED",
      "REOPENED",
    ]);
    expect(reopened.events.at(-1)?.actorUserId).toBe(approver.id);
  });
});
