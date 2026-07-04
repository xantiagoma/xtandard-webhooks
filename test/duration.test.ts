import { describe, expect, it } from "vitest";
import { durationToMs, parseDurationList } from "../src/duration.ts";

describe("durationToMs", () => {
  it("passes through non-negative numbers as milliseconds", () => {
    expect(durationToMs(0)).toBe(0);
    expect(durationToMs(250)).toBe(250);
  });

  it("parses unit strings", () => {
    expect(durationToMs("0s")).toBe(0);
    expect(durationToMs("5s")).toBe(5_000);
    expect(durationToMs("5m")).toBe(300_000);
    expect(durationToMs("2h")).toBe(7_200_000);
    expect(durationToMs("5d")).toBe(432_000_000);
    expect(durationToMs("150ms")).toBe(150);
    expect(durationToMs("1.5h")).toBe(5_400_000);
  });

  it("rejects malformed input", () => {
    expect(() => durationToMs(-1)).toThrow("Invalid duration");
    expect(() => durationToMs(Number.NaN)).toThrow("Invalid duration");
    expect(() => durationToMs("5x" as never)).toThrow("Invalid duration");
    expect(() => durationToMs("abc" as never)).toThrow("Invalid duration");
    expect(() => durationToMs("" as never)).toThrow("Invalid duration");
  });
});

describe("parseDurationList", () => {
  it("parses the RETRY_SCHEDULE env format", () => {
    expect(parseDurationList("0s,5s,5m,30m,2h,5h,10h")).toEqual([
      "0s",
      "5s",
      "5m",
      "30m",
      "2h",
      "5h",
      "10h",
    ]);
  });

  it("accepts bare millisecond numbers and trims whitespace", () => {
    expect(parseDurationList(" 0 , 5000 , 5m ")).toEqual([0, 5000, "5m"]);
  });

  it("throws on malformed entries", () => {
    expect(() => parseDurationList("0s,banana")).toThrow("Invalid duration");
  });
});
