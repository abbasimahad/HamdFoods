import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { recordAuditEvent } from "./audit-event";

function auditClient() {
  const create = vi.fn(async (input: unknown) => input);
  return { client: { auditEvent: { create } } as never, create };
}

describe("audit-event boundary", () => {
  // Defect: API keys and private keys can currently survive metadata scrubbing because
  // the sensitive-key policy recognizes generic secrets/tokens but not key credentials.
  it("recursively removes credential-like fields before persistence", async () => {
    const { client, create } = auditClient();

    await recordAuditEvent(client, {
      actorUserId: "actor-id",
      action: "UPDATE",
      entityType: "USER",
      entityId: "user-id",
      module: "administration",
      description: "Updated a user.",
      metadata: {
        safe: "retained",
        apiKey: "must-not-persist",
        nested: {
          privateKey: "must-not-persist",
          authorization: "must-not-persist",
          safeCount: 2,
        },
      },
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: {
          safe: "retained",
          nested: { safeCount: 2 },
        },
      }),
    });
  });

  it.each(["CANCEL", "REVERSE", "REOPEN", "OVERRIDE"] as const)(
    "rejects %s without a meaningful reason before persistence",
    async (action) => {
      const { client, create } = auditClient();

      await expect(
        recordAuditEvent(client, {
          actorUserId: "actor-id",
          action,
          entityType: "JOURNAL",
          entityId: "journal-id",
          module: "accounting",
          description: "Control action.",
          reason: "   ",
        }),
      ).rejects.toThrow("meaningful reason");
      expect(create).not.toHaveBeenCalled();
    },
  );
});
