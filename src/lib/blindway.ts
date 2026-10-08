export type Light = "RED" | "YELLOW" | "GREEN";
export type Status = "SAFE" | "DANGER";
export type ArduinoEvent = "GREEN_SAFE" | "VEHICLE_DETECTED";

export type ParsedLine =
  | { kind: "LIGHT"; value: Light }
  | { kind: "DISTANCE"; value: number }
  | { kind: "STATUS"; value: Status }
  | { kind: "EVENT"; value: ArduinoEvent };

function parseStructured(key: string, val: string): ParsedLine | null {
  switch (key) {
    case "LIGHT":
      return val === "RED" || val === "YELLOW" || val === "GREEN" ? { kind: "LIGHT", value: val } : null;
    case "DISTANCE": {
      const m = val.match(/^(\d+(?:\.\d+)?)\s*(CM)?$/);
      return m ? { kind: "DISTANCE", value: Number(m[1]) } : null;
    }
    case "STATUS":
      return val === "SAFE" || val === "DANGER" ? { kind: "STATUS", value: val } : null;
    case "EVENT":
      return val === "GREEN_SAFE" || val === "VEHICLE_DETECTED" ? { kind: "EVENT", value: val } : null;
  }
  return null;
}

/**
 * Parse one Arduino message. Supports structured KEY:VALUE lines and simple
 * human-readable text ("> OK TO MOVE", "DANGER", "18 cm"). Unknown -> [].
 */
export function parseMessage(raw: string): ParsedLine[] {
  const line = raw.trim().replace(/^>+\s*/, "").trim().toUpperCase();
  if (!line) return [];
  const idx = line.indexOf(":");
  if (idx > 0) {
    const r = parseStructured(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
    if (r) return [r];
  }
  const out: ParsedLine[] = [];
  const dist = line.match(/(?:DISTANCE\s*:?\s*)?(\d+(?:\.\d+)?)\s*CM\b/) ?? line.match(/^DISTANCE\s*:?\s*(\d+(?:\.\d+)?)$/);
  if (dist) out.push({ kind: "DISTANCE", value: Number(dist[1]) });

  if (/DANGER|VEHICLE|JUMPER|WARNING/.test(line)) {
    out.push({ kind: "STATUS", value: "DANGER" }, { kind: "EVENT", value: "VEHICLE_DETECTED" });
  } else if (/OK TO MOVE|ROAD CLEAR|\bSAFE\b/.test(line)) {
    out.push({ kind: "LIGHT", value: "GREEN" }, { kind: "STATUS", value: "SAFE" }, { kind: "EVENT", value: "GREEN_SAFE" });
  } else if (/\bRED\b/.test(line)) out.push({ kind: "LIGHT", value: "RED" });
  else if (/\bYELLOW\b/.test(line)) out.push({ kind: "LIGHT", value: "YELLOW" });
  else if (/\bGREEN\b/.test(line)) out.push({ kind: "LIGHT", value: "GREEN" });
  return out;
}

/** First parsed item of a line (kept for compatibility). */
export function parseLine(raw: string): ParsedLine | null {
  return parseMessage(raw)[0] ?? null;
}

/** Split a chunk buffer on \n; returns complete lines and the leftover partial line. */
export function splitBuffer(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.map((l) => l.trim()).filter(Boolean), rest };
}

export type Safety = "SAFE" | "DANGER" | "STOP" | "WAIT" | "CHECK" | "UNKNOWN";

export function deriveSafety(light: Light | null, status: Status | null): Safety {
  if (status === "DANGER" && light !== "RED" && light !== "YELLOW") return "DANGER";
  if (light === "RED") return "STOP";
  if (light === "YELLOW") return "WAIT";
  if (status === "SAFE") return "SAFE";
  if (light === "GREEN") return "CHECK";
  return "UNKNOWN";
}

export const VOICE: Record<ArduinoEvent, string> = {
  GREEN_SAFE: "It's OK to move",
  VEHICLE_DETECTED: "Danger! Vehicle detected. Do not cross.",
};
