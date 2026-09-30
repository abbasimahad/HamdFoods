import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/audit/audit-event", () => ({ recordAuditEvent: vi.fn() }));

const { autoOpenPeriodDecision, calendarMonthPeriod } = await import("./accounting-periods");

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe("calendarMonthPeriod", () => {
  it("spans the whole calendar month", () => {
    expect(calendarMonthPeriod(day("2026-10-15"))).toEqual({
      name: "October 2026",
      startDate: day("2026-10-01"),
      endDate: day("2026-10-31"),
    });
    expect(calendarMonthPeriod(day("2028-02-10")).endDate).toEqual(day("2028-02-29"));
  });
});

describe("autoOpenPeriodDecision (INST-6)", () => {
  const today = day("2026-09-30");

  it("opens the month on a fresh database with no periods", () => {
    const decision = autoOpenPeriodDecision({
      date: day("2026-09-26"),
      today,
      overlappingPeriods: 0,
      latestClosedEnd: null,
    });
    expect(decision).toEqual({ open: true, period: calendarMonthPeriod(day("2026-09-26")) });
  });

  it("opens October after September was closed", () => {
    expect(
      autoOpenPeriodDecision({
        date: day("2026-10-01"),
        today: day("2026-10-01"),
        overlappingPeriods: 0,
        latestClosedEnd: day("2026-09-30"),
      }).open,
    ).toBe(true);
  });

  it("never reopens or overlaps an existing (e.g. CLOSED) period", () => {
    expect(
      autoOpenPeriodDecision({
        date: day("2026-09-29"),
        today,
        overlappingPeriods: 1,
        latestClosedEnd: day("2026-09-30"),
      }),
    ).toEqual({ open: false, reason: "overlap" });
  });

  it("never opens a month before the latest closed period", () => {
    expect(
      autoOpenPeriodDecision({
        date: day("2026-08-15"),
        today,
        overlappingPeriods: 0,
        latestClosedEnd: day("2026-09-30"),
      }),
    ).toEqual({ open: false, reason: "before-close" });
  });

  it("never opens a period beyond next month", () => {
    expect(
      autoOpenPeriodDecision({
        date: day("2026-11-01"),
        today,
        overlappingPeriods: 0,
        latestClosedEnd: null,
      }).open,
    ).toBe(false);
    expect(
      autoOpenPeriodDecision({
        date: day("2026-10-31"),
        today,
        overlappingPeriods: 0,
        latestClosedEnd: null,
      }).open,
    ).toBe(true);
  });
});
