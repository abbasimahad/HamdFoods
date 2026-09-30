import { describe, expect, it } from "vitest";

import {
  factoryBusinessDate,
  factoryEffectiveInstant,
  factoryLocalDateTimeValue,
  parseFactoryLocalDateTime,
} from "./factory-local-time";

describe("factoryBusinessDate", () => {
  it("dates an early-morning PKT posting on the local day, not the UTC day (TZ-1)", () => {
    // 03:23 PKT on 27 Sep is 22:23 UTC on 26 Sep.
    expect(factoryBusinessDate(new Date("2026-09-26T22:23:00.000Z")).toISOString()).toBe(
      "2026-09-27T00:00:00.000Z",
    );
  });

  it("leaves a date-only value on the same day", () => {
    expect(factoryBusinessDate(new Date("2026-09-30T00:00:00.000Z")).toISOString()).toBe(
      "2026-09-30T00:00:00.000Z",
    );
  });

  it("keeps a late-afternoon posting on the same local day", () => {
    expect(factoryBusinessDate(new Date("2026-09-27T18:59:59.000Z")).toISOString()).toBe(
      "2026-09-27T00:00:00.000Z",
    );
  });
});

describe("factoryEffectiveInstant", () => {
  it("keeps the real posting instant when posted on the document's own local day (BUG-30)", () => {
    // Write-off dated 27 Sep, posted 23:10 PKT on 27 Sep (18:10 UTC).
    const postedAt = new Date("2026-09-27T18:10:00.000Z");
    expect(factoryEffectiveInstant(new Date("2026-09-27T00:00:00.000Z"), postedAt)).toBe(postedAt);
  });

  it("keeps an after-midnight PKT posting on its local day", () => {
    // 02:21 PKT on 28 Sep is 21:21 UTC on 27 Sep.
    const postedAt = new Date("2026-09-27T21:21:00.000Z");
    expect(factoryEffectiveInstant(new Date("2026-09-28T00:00:00.000Z"), postedAt)).toBe(postedAt);
  });

  it("places a back-dated document at the end of its local business day", () => {
    const instant = factoryEffectiveInstant(
      new Date("2026-09-25T00:00:00.000Z"),
      new Date("2026-09-27T10:00:00.000Z"),
    );
    expect(instant.toISOString()).toBe("2026-09-25T18:59:59.999Z");
    expect(factoryBusinessDate(instant).toISOString()).toBe("2026-09-25T00:00:00.000Z");
  });
});

describe("parseFactoryLocalDateTime", () => {
  it("reads a datetime-local value as PKT wall-clock time regardless of server timezone", () => {
    expect(parseFactoryLocalDateTime("2026-09-26T02:21").toISOString()).toBe(
      "2026-09-25T21:21:00.000Z",
    );
  });

  it("round-trips with factoryLocalDateTimeValue", () => {
    const instant = new Date("2026-09-27T17:53:00.000Z");
    expect(parseFactoryLocalDateTime(factoryLocalDateTimeValue(instant)).toISOString()).toBe(
      instant.toISOString(),
    );
  });

  it("keeps an explicit zone and rejects garbage", () => {
    expect(parseFactoryLocalDateTime("2026-09-27T10:00:00.000Z").toISOString()).toBe(
      "2026-09-27T10:00:00.000Z",
    );
    expect(Number.isNaN(parseFactoryLocalDateTime("not a date").getTime())).toBe(true);
  });
});
