export type Light = "RED" | "YELLOW" | "GREEN";
export type Status = "SAFE" | "DANGER" | "UNKNOWN";
export type ArduinoEvent = "RED_SAFE" | "VEHICLE_DETECTED" | "GREEN_SAFE";

export type ParsedLine =
  | { kind: "LIGHT"; value: Light }
  | { kind: "DISTANCE"; value: number | null }
  | { kind: "STATUS"; value: Status }
  | { kind: "EVENT"; value: ArduinoEvent }
  | { kind: "TIMING_ACK"; phase: Light; seconds: number };

export const LIGHTS: Light[] = ["RED", "YELLOW", "GREEN"];
const isLight = (v: string): v is Light => v === "RED" || v === "YELLOW" || v === "GREEN";

function parseStructured(key: string, val: string): ParsedLine[] | null {
  switch (key) {
    case "LIGHT":
      return isLight(val) ? [{ kind: "LIGHT", value: val }] : null;
    case "DISTANCE": {
      if (/^(INVALID|ERR|ERROR|TIMEOUT|-1)$/.test(val))
        return [{ kind: "DISTANCE", value: null }, { kind: "STATUS", value: "UNKNOWN" }];
      const m = val.match(/^(\d+(?:\.\d+)?)\s*(CM)?$/);
      return m ? [{ kind: "DISTANCE", value: Number(m[1]) }] : null;
    }
    case "STATUS":
      if (val === "SAFE" || val === "DANGER") return [{ kind: "STATUS", value: val }];
      if (val === "UNKNOWN" || val === "INVALID") return [{ kind: "STATUS", value: "UNKNOWN" }];
      return null;
    case "EVENT":
      return val === "RED_SAFE" || val === "GREEN_SAFE" || val === "VEHICLE_DETECTED" ? [{ kind: "EVENT", value: val }] : null;
    case "TIMING_SET": {
      const m = val.match(/^(RED|YELLOW|GREEN)\s*,\s*(\d{1,2})$/);
      if (!m) return null;
      const s = Number(m[2]);
      return s >= 1 && s <= 60 ? [{ kind: "TIMING_ACK", phase: m[1] as Light, seconds: s }] : null;
    }
  }
  return null;
}

/**
 * Parse one Arduino message. Supports structured KEY:VALUE lines and simple
 * human-readable text ("> OK TO MOVE", "DANGER", "18 cm"). Unknown -> [].
 */
export function parseMessage(raw: string): ParsedLine[] {
  let line = raw.trim().replace(/^>+\s*/, "").trim().toUpperCase();
  if (!line) return [];
  line = line.replace(/^TIMING_SET\s*,/, "TIMING_SET:");
  const idx = line.indexOf(":");
  if (idx > 0) {
    const r = parseStructured(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
    if (r) return r;
  }
  const out: ParsedLine[] = [];
  const dist = line.match(/(?:DISTANCE\s*:?\s*)?(\d+(?:\.\d+)?)\s*CM\b/) ?? line.match(/^DISTANCE\s*:?\s*(\d+(?:\.\d+)?)$/);
  if (dist) out.push({ kind: "DISTANCE", value: Number(dist[1]) });

  if (/DANGER|VEHICLE|JUMPER|WARNING/.test(line)) {
    out.push({ kind: "STATUS", value: "DANGER" }, { kind: "EVENT", value: "VEHICLE_DETECTED" });
  } else if (/OK TO MOVE|OK TO CROSS|ROAD CLEAR|\bSAFE\b/.test(line)) {
    out.push({ kind: "STATUS", value: "SAFE" });
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

/** Readings older than this are treated as stale -> UNKNOWN / do not cross. */
export const STALE_MS = 3000;
export function isStale(lastDataAt: number | null, now: number): boolean {
  return lastDataAt == null || now - lastDataAt > STALE_MS;
}

export type Safety = "SAFE" | "DANGER" | "WAIT" | "GREEN_WAIT" | "UNKNOWN";

/**
 * Pedestrians may cross only on RED with a verified SAFE sensor reading.
 * YELLOW / GREEN = vehicles' turn, pedestrians wait.
 */
export function deriveSafety(light: Light | null, status: Status | null, stale = false): Safety {
  if (stale) return "UNKNOWN";
  if (light === "YELLOW") return "WAIT";
  if (light === "GREEN") return "GREEN_WAIT";
  if (status === "DANGER") return "DANGER";
  if (light === "RED" && status === "SAFE") return "SAFE";
  return "UNKNOWN";
}

export type Announcement = "SAFE" | "DANGER";
export const VOICE: Record<Announcement, string> = {
  SAFE: "The signal is red. The road is clear. It is OK to cross.",
  DANGER: "Danger! Vehicle detected. Do not cross.",
};

/** Announce only when the safety state transitions into SAFE or DANGER. */
export function announcementFor(prev: Safety | null, next: Safety): Announcement | null {
  if (prev === next) return null;
  return next === "SAFE" || next === "DANGER" ? next : null;
}

/* ---------- Traffic light timing ---------- */

export type Timings = Record<Light, number>;
export const DEFAULT_TIMINGS: Timings = { RED: 5, YELLOW: 3, GREEN: 10 };
export const TIMING_KEY = "blindway.timings";

/** Returns whole seconds 1–60, or an error message. */
export function validateSeconds(raw: string): { ok: true; value: number } | { ok: false; error: string } {
  const v = raw.trim();
  if (!v) return { ok: false, error: "Enter a value." };
  if (!/^-?\d+(\.\d+)?$/.test(v)) return { ok: false, error: "Use numbers only." };
  if (!/^\d+$/.test(v)) return { ok: false, error: "Use whole seconds (no decimals or minus sign)." };
  const n = Number(v);
  if (n < 1 || n > 60) return { ok: false, error: "Must be between 1 and 60 seconds." };
  return { ok: true, value: n };
}

export function timingCommands(t: Timings): string[] {
  return LIGHTS.map((l) => `SET_TIMING,${l},${t[l]}`);
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;
export function loadTimings(s: StorageLike): Timings {
  try {
    const p = JSON.parse(s.getItem(TIMING_KEY) ?? "null");
    const out = { ...DEFAULT_TIMINGS };
    for (const l of LIGHTS) {
      const r = validateSeconds(String(p?.[l] ?? ""));
      if (r.ok) out[l] = r.value;
    }
    return out;
  } catch {
    return { ...DEFAULT_TIMINGS };
  }
}
export function saveTimings(s: StorageLike, t: Timings) {
  s.setItem(TIMING_KEY, JSON.stringify(t));
}

export const ACK_TIMEOUT_MS = 4000;
export type HardwareStatus = "APPLIED" | "PENDING" | "NO_ACK" | "LOCAL";
/** Hardware status is APPLIED only after the Arduino echoed the exact value. */
export function hardwareStatus(
  desired: number,
  acked: number | undefined,
  connected: boolean,
  sentAt: number | null,
  now: number,
): HardwareStatus {
  if (!connected) return "LOCAL";
  if (acked === desired) return "APPLIED";
  if (sentAt != null && now - sentAt > ACK_TIMEOUT_MS) return "NO_ACK";
  return "PENDING";
}
