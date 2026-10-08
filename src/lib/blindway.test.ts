import { describe, it, expect } from "vitest";
import { parseLine, splitBuffer, deriveSafety } from "./blindway";

describe("parser", () => {
  it("parses known messages", () => {
    expect(parseLine(" LIGHT:GREEN\r")).toEqual({ kind: "LIGHT", value: "GREEN" });
    expect(parseLine("DISTANCE:18")).toEqual({ kind: "DISTANCE", value: 18 });
    expect(parseLine("STATUS:DANGER")).toEqual({ kind: "STATUS", value: "DANGER" });
    expect(parseLine("EVENT:VEHICLE_DETECTED")).toEqual({ kind: "EVENT", value: "VEHICLE_DETECTED" });
  });
  it("ignores unknown messages", () => {
    expect(parseLine("HELLO")).toBeNull();
    expect(parseLine("LIGHT:BLUE")).toBeNull();
    expect(parseLine("DISTANCE:abc")).toBeNull();
  });
  it("splits on newline keeping partial", () => {
    expect(splitBuffer("LIGHT:RED\nDIST")).toEqual({ lines: ["LIGHT:RED"], rest: "DIST" });
  });
});

describe("safety", () => {
  it("safe only when green and SAFE", () => {
    expect(deriveSafety("GREEN", "SAFE")).toBe("SAFE");
    expect(deriveSafety("GREEN", null)).toBe("UNKNOWN");
  });
  it("green + danger is danger", () => expect(deriveSafety("GREEN", "DANGER")).toBe("DANGER"));
  it("red stop, yellow wait", () => {
    expect(deriveSafety("RED", "SAFE")).toBe("STOP");
    expect(deriveSafety("YELLOW", "SAFE")).toBe("WAIT");
  });
});
