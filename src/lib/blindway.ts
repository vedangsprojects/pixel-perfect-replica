export type Light = "RED" | "YELLOW" | "GREEN";
export type Status = "SAFE" | "DANGER";
export type ArduinoEvent = "GREEN_SAFE" | "VEHICLE_DETECTED";

export type ParsedLine =
  | { kind: "LIGHT"; value: Light }
  | { kind: "DISTANCE"; value: number }
  | { kind: "STATUS"; value: Status }
  | { kind: "EVENT"; value: ArduinoEvent };

/** Parse one newline-separated Arduino message. Unknown messages return null. */
export function parseLine(raw: string): ParsedLine | null {
  const line = raw.trim();
  const idx = line.indexOf(":");
  if (idx < 0) return null;
  const key = line.slice(0, idx).trim().toUpperCase();
  const val = line.slice(idx + 1).trim().toUpperCase();
  switch (key) {
    case "LIGHT":
      return val === "RED" || val === "YELLOW" || val === "GREEN" ? { kind: "LIGHT", value: val } : null;
    case "DISTANCE": {
      const n = Number(val);
      return val !== "" && Number.isFinite(n) && n >= 0 ? { kind: "DISTANCE", value: n } : null;
    }
    case "STATUS":
      return val === "SAFE" || val === "DANGER" ? { kind: "STATUS", value: val } : null;
    case "EVENT":
      return val === "GREEN_SAFE" || val === "VEHICLE_DETECTED" ? { kind: "EVENT", value: val } : null;
  }
  return null;
}

/** Split a chunk buffer on \n; returns complete lines and the leftover partial line. */
export function splitBuffer(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.map((l) => l.trim()).filter(Boolean), rest };
}

export type Safety = "SAFE" | "DANGER" | "STOP" | "WAIT" | "UNKNOWN";

export function deriveSafety(light: Light | null, status: Status | null): Safety {
  if (light === "RED") return "STOP";
  if (light === "YELLOW") return "WAIT";
  if (light === "GREEN") {
    if (status === "DANGER") return "DANGER";
    if (status === "SAFE") return "SAFE";
  }
  return "UNKNOWN";
}

export const VOICE: Record<ArduinoEvent, string> = {
  GREEN_SAFE: "It's OK to move",
  VEHICLE_DETECTED: "Danger! Vehicle detected. Do not cross.",
};
