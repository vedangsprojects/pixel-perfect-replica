import { describe, it, expect } from "vitest";
import {
  parseLine,
  parseMessage,
  splitBuffer,
  deriveSafety,
  announcementFor,
  isStale,
  STALE_MS,
  validateSeconds,
  timingCommands,
  loadTimings,
  saveTimings,
  hardwareStatus,
  DEFAULT_TIMINGS,
  ACK_TIMEOUT_MS,
  type Safety,
} from "./blindway";

describe("parser", () => {
  it("parses known messages", () => {
    expect(parseLine(" LIGHT:GREEN\r")).toEqual({ kind: "LIGHT", value: "GREEN" });
    expect(parseLine("DISTANCE:18")).toEqual({ kind: "DISTANCE", value: 18 });
    expect(parseLine("STATUS:DANGER")).toEqual({ kind: "STATUS", value: "DANGER" });
    expect(parseLine("EVENT:RED_SAFE")).toEqual({ kind: "EVENT", value: "RED_SAFE" });
  });
  it("invalid distance means unknown status", () => {
    expect(parseMessage("DISTANCE:INVALID")).toEqual([
      { kind: "DISTANCE", value: null },
      { kind: "STATUS", value: "UNKNOWN" },
    ]);
  });
  it("parses timing acknowledgements", () => {
    expect(parseLine("TIMING_SET:RED,5")).toEqual({ kind: "TIMING_ACK", phase: "RED", seconds: 5 });
    expect(parseLine("TIMING_SET,GREEN,10")).toEqual({ kind: "TIMING_ACK", phase: "GREEN", seconds: 10 });
    expect(parseLine("TIMING_SET:RED,99")).toBeNull();
  });
  it("ignores unknown messages", () => {
    expect(parseLine("HELLO")).toBeNull();
    expect(parseLine("LIGHT:BLUE")).toBeNull();
  });
  it("splits on newline keeping partial", () => {
    expect(splitBuffer("LIGHT:RED\nDIST")).toEqual({ lines: ["LIGHT:RED"], rest: "DIST" });
  });
});

describe("safety", () => {
  it("red + safe is OK to cross", () => expect(deriveSafety("RED", "SAFE")).toBe("SAFE"));
  it("red + danger is danger", () => expect(deriveSafety("RED", "DANGER")).toBe("DANGER"));
  it("green never safe", () => expect(deriveSafety("GREEN", "SAFE")).toBe("GREEN_WAIT"));
  it("yellow never safe", () => expect(deriveSafety("YELLOW", "SAFE")).toBe("WAIT"));
  it("red + unknown sensor is unknown", () => expect(deriveSafety("RED", "UNKNOWN")).toBe("UNKNOWN"));
  it("stale data is unknown", () => expect(deriveSafety("RED", "SAFE", true)).toBe("UNKNOWN"));
  it("stale after threshold", () => {
    expect(isStale(1000, 1000 + STALE_MS + 1)).toBe(true);
    expect(isStale(1000, 1500)).toBe(false);
    expect(isStale(null, 0)).toBe(true);
  });
});

describe("announcements", () => {
  const count = (seq: Safety[]) => {
    let prev: Safety | null = null;
    const out: string[] = [];
    for (const s of seq) {
      const a = announcementFor(prev, s);
      if (a) out.push(a);
      prev = s;
    }
    return out;
  };
  it("repeated red+safe announces once", () => expect(count(["SAFE", "SAFE", "SAFE"])).toEqual(["SAFE"]));
  it("repeated danger announces once", () => expect(count(["DANGER", "DANGER"])).toEqual(["DANGER"]));
  it("danger never announces safe", () => expect(count(["DANGER"])).not.toContain("SAFE"));
  it("green and yellow are silent", () => expect(count(["GREEN_WAIT", "WAIT", "GREEN_WAIT"])).toEqual([]));
  it("new cycle announces again", () =>
    expect(count(["SAFE", "GREEN_WAIT", "WAIT", "SAFE"])).toEqual(["SAFE", "SAFE"]));
});

describe("timing", () => {
  it("rejects out of range / invalid", () => {
    for (const v of ["0", "61", "", "-3", "2.5", "abc"]) expect(validateSeconds(v).ok).toBe(false);
  });
  it("accepts 1 and 60", () => {
    expect(validateSeconds("1")).toEqual({ ok: true, value: 1 });
    expect(validateSeconds("60")).toEqual({ ok: true, value: 60 });
  });
  it("builds commands with real values", () =>
    expect(timingCommands({ RED: 7, YELLOW: 2, GREEN: 15 })).toEqual([
      "SET_TIMING,RED,7",
      "SET_TIMING,YELLOW,2",
      "SET_TIMING,GREEN,15",
    ]));
  it("persists across reload", () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(loadTimings(s)).toEqual(DEFAULT_TIMINGS);
    saveTimings(s, { RED: 8, YELLOW: 4, GREEN: 20 });
    expect(loadTimings(s)).toEqual({ RED: 8, YELLOW: 4, GREEN: 20 });
  });
  it("applied only after matching ack", () => {
    expect(hardwareStatus(5, undefined, true, 0, 100)).toBe("PENDING");
    expect(hardwareStatus(5, 5, true, 0, 100)).toBe("APPLIED");
    expect(hardwareStatus(5, 4, true, 0, ACK_TIMEOUT_MS + 1)).toBe("NO_ACK");
    expect(hardwareStatus(5, 5, false, 0, 100)).toBe("LOCAL");
  });
});
