import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";

const pageSize = 50;

export async function auditPage(query: {
  from?: string;
  to?: string;
  userId?: string;
  module?: string;
  action?: string;
  entityType?: string;
  reference?: string;
  page?: string;
}) {
  const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
  const occurredAt = dateRange(query.from, query.to);
  const where: Prisma.AuditEventWhereInput = {
    ...(occurredAt ? { occurredAt } : {}),
    ...(query.userId ? { actorUserId: query.userId } : {}),
    ...(query.module ? { module: query.module } : {}),
    ...(query.action ? { action: query.action as never } : {}),
    ...(query.entityType ? { entityType: query.entityType as never } : {}),
    ...(query.reference
      ? {
          OR: [
            { entityReference: { contains: query.reference, mode: "insensitive" } },
            { entityId: { contains: query.reference, mode: "insensitive" } },
            { description: { contains: query.reference, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [total, events, users, modules] = await Promise.all([
    prisma.auditEvent.count({ where }),
    prisma.auditEvent.findMany({
      where,
      include: { actor: true },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: pageSize,
      skip: (page - 1) * pageSize,
    }),
    prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.auditEvent.findMany({
      distinct: ["module"],
      select: { module: true },
      orderBy: { module: "asc" },
    }),
  ]);
  return { page, pageSize, total, events, users, modules: modules.map((row) => row.module) };
}

export async function auditDetail(id: string) {
  return prisma.auditEvent.findUnique({ where: { id }, include: { actor: true } });
}

export async function entityAuditTimeline(entityType: string, entityId: string) {
  return prisma.auditEvent.findMany({
    where: { entityType: entityType as never, entityId },
    include: { actor: true },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: 30,
  });
}

export async function controlEventSummary() {
  const events = await prisma.auditEvent.findMany({
    where: { controlEvent: true },
    include: { actor: true },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: 20,
  });
  return events;
}

function dateRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  const start = validDate(from);
  const end = validDate(to, true);
  return start || end
    ? { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) }
    : undefined;
}
function validDate(value?: string, endOfDay = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
}
