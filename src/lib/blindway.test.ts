import { describe, it, expect } from "vitest";
import { parseLine, parseMessage, splitBuffer, deriveSafety } from "./blindway";

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
  it("green alone is check road", () => expect(deriveSafety("GREEN", null)).toBe("CHECK"));
  it("green + danger is danger", () => expect(deriveSafety("GREEN", "DANGER")).toBe("DANGER"));
  it("red stop, yellow wait", () => {
    expect(deriveSafety("RED", "SAFE")).toBe("STOP");
    expect(deriveSafety("YELLOW", "SAFE")).toBe("WAIT");
  });
});

function run(lines: string[]) {
  let light: any = null, status: any = null;
  for (const l of lines) for (const p of parseMessage(l)) {
    if (p.kind === "LIGHT") light = p.value;
    if (p.kind === "STATUS") status = p.value;
  }
  return { light, status, safety: deriveSafety(light, status) };
}

describe("simple text messages", () => {
  it("> OK TO MOVE is safe + green", () => expect(run(["> OK TO MOVE"])).toEqual({ light: "GREEN", status: "SAFE", safety: "SAFE" }));
  it("OK TO MOVE / STATUS:SAFE safe", () => {
    expect(run(["ok to move"]).safety).toBe("SAFE");
    expect(run(["STATUS:SAFE"]).safety).toBe("SAFE");
  });
  it("danger variants", () => {
    for (const m of ["> DANGER", "VEHICLE DETECTED", "JUMPER DETECTED", "WARNING", "DANGER! VEHICLE TOO CLOSE", "STATUS:DANGER"])
      expect(run(["OK TO MOVE", m]).safety).toBe("DANGER");
  });
  it("lights", () => {
    expect(run(["LIGHT:RED"]).safety).toBe("STOP");
    expect(run(["YELLOW"]).safety).toBe("WAIT");
    expect(run(["LIGHT:GREEN"]).safety).toBe("CHECK");
  });
  it("distance formats", () => {
    for (const m of ["DISTANCE:18", "Distance: 18 cm", "18 cm"])
      expect(parseMessage(m)).toContainEqual({ kind: "DISTANCE", value: 18 });
  });
});
