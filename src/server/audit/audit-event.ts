import "server-only";

import {
  AuditActionType,
  AuditEntityType,
  AuditReasonCode,
  Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";

type AuditClient = Prisma.TransactionClient | PrismaClient;
type Snapshot = Record<string, string | number | boolean | null | undefined>;

export type AuditEventInput = {
  actorUserId: string;
  action: AuditActionType;
  entityType: AuditEntityType;
  entityId: string;
  entityReference?: string | null;
  module: string;
  description: string;
  reasonCode?: AuditReasonCode | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  beforeSnapshot?: Snapshot | null;
  afterSnapshot?: Snapshot | null;
  related?: { entityType: AuditEntityType; entityId: string; reference?: string | null } | null;
  controlEvent?: boolean;
};

export async function recordAuditEvent(client: AuditClient, input: AuditEventInput) {
  const reason = input.reason?.trim() || null;
  if (
    input.action === "CANCEL" ||
    input.action === "REVERSE" ||
    input.action === "REOPEN" ||
    input.action === "OVERRIDE"
  ) {
    if (!reason)
      throw new Error(`A meaningful reason is required for ${input.action.toLowerCase()}.`);
  }
  return client.auditEvent.create({
    data: {
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      entityReference: input.entityReference ?? null,
      module: input.module,
      description: input.description,
      reasonCode: input.reasonCode ?? null,
      reason,
      ...(input.metadata === undefined ? {} : { metadata: databaseJson(input.metadata) }),
      ...(input.beforeSnapshot === undefined
        ? {}
        : { beforeSnapshot: databaseJson(input.beforeSnapshot) }),
      ...(input.afterSnapshot === undefined
        ? {}
        : { afterSnapshot: databaseJson(input.afterSnapshot) }),
      relatedEntityType: input.related?.entityType ?? null,
      relatedEntityId: input.related?.entityId ?? null,
      relatedReference: input.related?.reference ?? null,
      controlEvent: input.controlEvent ?? false,
    },
  });
}

function databaseJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null ? Prisma.JsonNull : scrub(value);
}

function scrub(value: unknown): Prisma.InputJsonValue {
  if (value === null || value === undefined) return null as unknown as Prisma.InputJsonValue;
  if (Array.isArray(value)) return value.map((entry) => scrub(entry)) as Prisma.InputJsonValue;
  if (typeof value === "object") {
    const safe: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (/(password|token|secret|credential|authorization|api.?key|private.?key)/i.test(key))
        continue;
      safe[key] = scrub(entry);
    }
    return safe;
  }
  if (["string", "number", "boolean"].includes(typeof value)) return value as Prisma.InputJsonValue;
  return String(value);
}
