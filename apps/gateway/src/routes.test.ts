import { describe, expect, it } from "vitest";

describe("gateway command rules", () => {
  it("keeps alarm delay inside the FPGA-supported range", () => {
    const isValidDelay = (value: number) => value >= 0 && value <= 120;
    expect(isValidDelay(0)).toBe(true);
    expect(isValidDelay(120)).toBe(true);
    expect(isValidDelay(121)).toBe(false);
  });

  it("recognizes the demo PIN format", () => {
    expect(/^\d{4,8}$/.test("1234")).toBe(true);
    expect(/^\d{4,8}$/.test("12ab")).toBe(false);
  });
});
