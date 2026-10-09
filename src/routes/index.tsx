import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useArduinoSerial, isWebSerialSupported } from "@/hooks/useArduinoSerial";
import {
  announcementFor,
  deriveSafety,
  hardwareStatus,
  isStale,
  loadTimings,
  saveTimings,
  timingCommands,
  validateSeconds,
  DEFAULT_TIMINGS,
  LIGHTS,
  VOICE,
  type Light,
  type Safety,
  type Timings,
} from "@/lib/blindway";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BLINDWAY — Smart Road Crossing Safety System" },
      { name: "description", content: "Live Arduino dashboard for the BLINDWAY smart road crossing for visually impaired pedestrians." },
      { property: "og:title", content: "BLINDWAY — Smart Road Crossing Safety System" },
      { property: "og:description", content: "Connect an Arduino over USB and see the crossing light, distance and safety status live." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

interface HistoryItem {
  id: number;
  time: string;
  icon: string;
  label: string;
  distance: number | null;
  light: Light | null;
}

const DEMO_STREAM = [
  ["LIGHT:GREEN", "STATUS:DANGER", "DISTANCE:6"],
  ["LIGHT:YELLOW", "STATUS:SAFE", "DISTANCE:22"],
  ["LIGHT:RED", "DISTANCE:24", "STATUS:SAFE", "EVENT:RED_SAFE"],
  ["LIGHT:RED", "DISTANCE:23", "STATUS:SAFE"],
  ["LIGHT:RED", "DISTANCE:5", "STATUS:DANGER", "EVENT:VEHICLE_DETECTED"],
];

const HISTORY_LABEL: Record<Safety, [string, string]> = {
  SAFE: ["🟢", "Red light - Road clear - OK to cross"],
  DANGER: ["🚨", "Vehicle detected - Do not cross"],
  WAIT: ["🟡", "Yellow light - Wait"],
  GREEN_WAIT: ["🛑", "Green light - Vehicles have the signal"],
  UNKNOWN: ["⚠️", "Road status unknown - Do not cross"],
};

function Index() {
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [demo, setDemo] = useState(false);
  const [supported, setSupported] = useState(true);
  const [monitorOpen, setMonitorOpen] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [timings, setTimings] = useState<Timings>(DEFAULT_TIMINGS);
  const [acked, setAcked] = useState<Partial<Timings>>({});
  const [sentAt, setSentAt] = useState<number | null>(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const timingsRef = useRef(timings);
  timingsRef.current = timings;
  const hid = useRef(0);
  const prevSafety = useRef<Safety | null>(null);

  useEffect(() => {
    setSupported(isWebSerialSupported());
    setTimings(loadTimings(window.localStorage));
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const speak = useCallback((text: string, force = false) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel(); // never overlap; newest (state-change) message wins
    if (mutedRef.current && !force) return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    u.onstart = () => setSpeaking(true);
    u.onend = u.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
  }, []);

  const serial = useArduinoSerial({
    onTimingAck: (phase, seconds) => setAcked((a) => ({ ...a, [phase]: seconds })),
  });

  const stale = isStale(serial.lastDataAt, now);
  const safety = deriveSafety(serial.light, serial.status, stale);

  // Event-based voice + history: runs only when the derived safety state changes.
  useEffect(() => {
    const prev = prevSafety.current;
    prevSafety.current = safety;
    if (prev === safety) return;
    const a = announcementFor(prev, safety);
    if (a) speak(VOICE[a]);
    else if (prev === "SAFE" && typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    if (prev === null && safety === "UNKNOWN") return;
    const [icon, label] = HISTORY_LABEL[safety];
    setHistory((h) =>
      [{ id: ++hid.current, time: new Date().toLocaleTimeString(), icon, label, distance: serial.distance, light: serial.light }, ...h].slice(0, 50),
    );
  }, [safety, speak, serial.distance, serial.light]);

  // Demo mode: clearly labelled, off by default
  useEffect(() => {
    if (!demo) return;
    let i = 0;
    const t = setInterval(() => {
      (DEMO_STREAM[i % DEMO_STREAM.length] ?? []).forEach(serial.ingest);
      i++;
    }, 2500);
    return () => clearInterval(t);
  }, [demo, serial.ingest]);

  const pushTimings = useCallback(
    async (t: Timings) => {
      setAcked({});
      setSentAt(null);
      if (await serial.send(timingCommands(t))) setSentAt(Date.now());
    },
    [serial.send],
  );

  // Arduino resets when the port opens: send saved timings once it has booted.
  useEffect(() => {
    if (!serial.isConnected) {
      setAcked({});
      setSentAt(null);
      return;
    }
    const t = setTimeout(() => void pushTimings(timingsRef.current), 2000);
    return () => clearTimeout(t);
  }, [serial.isConnected, pushTimings]);

  const saveAndApply = (t: Timings) => {
    setTimings(t);
    saveTimings(window.localStorage, t);
    if (serial.isConnected) void pushTimings(t);
  };

  const voiceState = muted ? "MUTED" : speaking ? "SPEAKING" : "VOICE READY";

  return (
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-5xl font-bold tracking-[0.2em] text-primary">BLINDWAY</h1>
          <p className="mt-1 font-mono text-sm tracking-widest text-muted-foreground">SMART ROAD CROSSING SAFETY SYSTEM</p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 font-mono text-xs">
          <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} />
          DEMO MODE {demo && <span className="text-sig-yellow">(SIMULATED DATA)</span>}
        </label>
      </header>

      <section className="panel flex flex-wrap items-center gap-6" aria-label="Arduino connection">
        <Stat label="Arduino Connection">
          <span className={serial.isConnected ? "text-sig-green" : "text-destructive"}>
            ● {serial.isConnected ? "CONNECTED" : "DISCONNECTED"}
          </span>
        </Stat>
        <Stat label="COM Port">{serial.isConnected ? serial.portLabel : "—"}</Stat>
        <Stat label="Baud Rate">{serial.baudRate}</Stat>
        <Stat label="Last valid data">
          {serial.lastDataAt ? (
            <span className={stale ? "text-sig-yellow" : ""}>
              {new Date(serial.lastDataAt).toLocaleTimeString()}
              {stale && " (stale)"}
            </span>
          ) : (
            "—"
          )}
        </Stat>
        <div className="ml-auto flex flex-wrap gap-3">
          <button
            onClick={serial.connect}
            disabled={serial.isConnected}
            className="rounded-lg bg-primary px-6 py-3 text-lg font-bold tracking-wide text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
          >
            🔌 CONNECT ARDUINO
          </button>
          <button
            onClick={serial.disconnect}
            disabled={!serial.isConnected}
            className="rounded-lg border px-5 py-3 font-semibold transition hover:bg-accent disabled:opacity-40"
          >
            DISCONNECT
          </button>
        </div>
        {(!supported || serial.error) && (
          <p role="alert" className="w-full rounded-lg border border-destructive bg-destructive/10 px-4 py-2 text-sm">
            {serial.error ??
              "Web Serial is not supported in this browser. Please use a supported Chromium-based browser such as Google Chrome or Microsoft Edge."}
          </p>
        )}
        {serial.lastMessage && (
          <div className="w-full font-mono text-xs text-muted-foreground">
            <p>Latest raw message: &gt; {serial.lastMessage}</p>
            <p className="mt-1 text-primary">PARSED STATUS: {serial.status ?? "—"} · PARSED LIGHT: {serial.light ?? "—"}</p>
          </div>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-[260px_1fr_300px]">
        <TrafficLight light={stale ? null : serial.light} />
        <SafetyCard safety={safety} hasData={serial.lastDataAt != null} />
        <div className="space-y-5">
          <DistanceCard distance={stale ? null : serial.distance} />
          <section className="panel space-y-3" aria-label="Voice controls">
            <div className="flex items-center justify-between">
              <h2 className="font-mono text-xs tracking-widest text-muted-foreground">VOICE</h2>
              <span
                aria-live="polite"
                className={`rounded border px-2 py-0.5 font-mono text-xs ${muted ? "text-destructive" : speaking ? "text-sig-green" : "text-primary"}`}
              >
                {voiceState}
              </span>
            </div>
            <button onClick={() => speak("BLINDWAY voice test.", true)} className="w-full rounded-lg bg-secondary px-4 py-3 font-semibold hover:bg-accent">
              🔊 TEST VOICE
            </button>
            <button onClick={() => setMuted((m) => !m)} className="w-full rounded-lg border px-4 py-3 font-semibold hover:bg-accent" aria-pressed={muted}>
              {muted ? "🔇 UNMUTE" : "🔈 MUTE"}
            </button>
          </section>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="panel" aria-label="Event history">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-mono text-xs tracking-widest text-muted-foreground">EVENT HISTORY</h2>
            <button onClick={() => setHistory([])} className="rounded border px-3 py-1 text-xs hover:bg-accent">CLEAR HISTORY</button>
          </div>
          <ul className="max-h-80 space-y-2 overflow-y-auto">
            {history.length === 0 && <li className="text-sm text-muted-foreground">No events yet.</li>}
            {history.map((h) => (
              <li key={h.id} className="flex items-center gap-3 rounded-lg bg-panel px-3 py-2 text-sm">
                <span className="font-mono text-xs text-muted-foreground">{h.time}</span>
                <span>{h.icon}</span>
                <span className="flex-1">{h.label}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {h.distance != null ? `${h.distance} cm` : "-- cm"} · {h.light ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel" aria-label="Arduino serial monitor">
          <div className="mb-3 flex items-center justify-between">
            <button onClick={() => setMonitorOpen((o) => !o)} className="font-mono text-xs tracking-widest text-muted-foreground" aria-expanded={monitorOpen}>
              {monitorOpen ? "▾" : "▸"} ARDUINO SERIAL MONITOR
            </button>
            <button onClick={serial.clearMessages} className="rounded border px-3 py-1 text-xs hover:bg-accent">CLEAR SERIAL LOG</button>
          </div>
          {monitorOpen && <SerialMonitor lines={serial.messages} />}
        </section>
      </div>

      <section className="panel" aria-label="Arduino setup">
        <h2 className="mb-3 font-mono text-xs tracking-widest text-muted-foreground">ARDUINO SETUP</h2>
        <ol className="grid gap-3 text-sm sm:grid-cols-5">
          {[
            ["Arduino USB", "→ Computer"],
            ["Baud rate", "→ 9600"],
            ["Browser", "→ Chrome / Edge"],
            ["Click", "→ Connect Arduino"],
            ["Select", "→ Arduino COM port"],
          ].map(([a, b], i) => (
            <li key={a} className="rounded-lg bg-panel p-3">
              <span className="font-mono text-primary">{i + 1}.</span> <b>{a}</b> {b}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">
          Close the Arduino IDE Serial Monitor first — only one program can use the port at a time. All data stays in your browser. School
          prototype only — not a certified pedestrian safety system.
        </p>
      </section>

      <TimingSettings
        timings={timings}
        onSave={saveAndApply}
        connected={serial.isConnected}
        acked={acked}
        sentAt={sentAt}
        now={now}
      />
    </main>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-xs tracking-widest text-muted-foreground">{label.toUpperCase()}</div>
      <div className="text-lg font-semibold">{children}</div>
    </div>
  );
}

const LAMP_CLS: Record<Light, string> = {
  RED: "bg-sig-red text-sig-red",
  YELLOW: "bg-sig-yellow text-sig-yellow",
  GREEN: "bg-sig-green text-sig-green",
};

function TrafficLight({ light }: { light: Light | null }) {
  const caption = { RED: "🔴 RED — VEHICLES STOP", YELLOW: "🟡 YELLOW — WAIT", GREEN: "🟢 GREEN — PEDESTRIANS WAIT" };
  return (
    <section className="panel flex flex-col items-center gap-4" aria-label="Traffic light">
      <div className="flex flex-col gap-4 rounded-3xl border-4 bg-panel p-5">
        {LIGHTS.map((l) => (
          <div
            key={l}
            aria-label={`${l} lamp ${light === l ? "on" : "off"}`}
            className={`h-20 w-20 rounded-full transition-all duration-300 ${LAMP_CLS[l]} ${light === l ? "lamp-glow opacity-100" : "opacity-15"}`}
          />
        ))}
      </div>
      <p className="text-center text-lg font-bold">{light ? caption[light] : "Waiting for signal…"}</p>
    </section>
  );
}

function SafetyCard({ safety, hasData }: { safety: Safety; hasData: boolean }) {
  const view = {
    SAFE: { cls: "border-sig-green bg-sig-green/15", title: "🟢 OK TO CROSS", sub: ["Signal red · Road clear"] },
    DANGER: { cls: "border-destructive bg-destructive/25 danger-pulse", title: "🚨 DANGER", sub: ["DO NOT CROSS", "Vehicle detected"] },
    WAIT: { cls: "border-sig-yellow bg-sig-yellow/10", title: "🟡 WAIT", sub: ["Signal is changing"] },
    GREEN_WAIT: { cls: "border-sig-red bg-sig-red/10", title: "🛑 WAIT", sub: ["Vehicles have the signal"] },
    UNKNOWN: hasData
      ? { cls: "border-sig-yellow bg-card", title: "⚠️ ROAD STATUS UNKNOWN", sub: ["DO NOT CROSS"] }
      : { cls: "border-border bg-card", title: "— NO DATA —", sub: ["Connect the Arduino to begin"] },
  }[safety];
  return (
    <section
      role="status"
      aria-live="assertive"
      className={`flex min-h-80 flex-col items-center justify-center rounded-2xl border-4 p-6 text-center transition-colors ${view.cls}`}
    >
      <h2 className="text-5xl font-bold tracking-wide md:text-6xl">{view.title}</h2>
      {view.sub.map((s) => (
        <p key={s} className="mt-3 text-2xl font-semibold md:text-3xl">{s}</p>
      ))}
    </section>
  );
}

function DistanceCard({ distance }: { distance: number | null }) {
  const pct = distance == null ? 0 : Math.max(4, 100 - Math.min(distance, 50) * 2);
  const color = distance == null ? "bg-muted" : distance < 10 ? "bg-destructive" : distance < 20 ? "bg-sig-yellow" : "bg-sig-green";
  return (
    <section className="panel" aria-label="Ultrasonic distance">
      <h2 className="font-mono text-xs tracking-widest text-muted-foreground">DISTANCE</h2>
      <p className="my-2 font-mono text-5xl font-bold">{distance == null ? "--" : distance} <span className="text-2xl">cm</span></p>
      <div className="h-3 overflow-hidden rounded-full bg-panel" aria-hidden>
        <div className={`h-full transition-all duration-300 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Bar fills as an object gets closer</p>
    </section>
  );
}

function SerialMonitor({ lines }: { lines: { id: number; time: string; text: string }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [lines]);
  return (
    <div ref={ref} className="h-80 overflow-y-auto rounded-lg bg-panel p-3 font-mono text-sm">
      {lines.length === 0 && <p className="text-muted-foreground">Waiting for serial data…</p>}
      {lines.map((l) => (
        <div key={l.id}>
          <span className="text-muted-foreground">{l.time}</span> <span className="text-primary">&gt;</span> {l.text}
        </div>
      ))}
    </div>
  );
}

function TimingSettings(props: {
  timings: Timings;
  onSave: (t: Timings) => void;
  connected: boolean;
  acked: Partial<Timings>;
  sentAt: number | null;
  now: number;
}) {
  const { timings, onSave, connected, acked, sentAt, now } = props;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Record<Light, string>>({ RED: "", YELLOW: "", GREEN: "" });
  const [errors, setErrors] = useState<Partial<Record<Light, string>>>({});
  const [saved, setSaved] = useState(false);

  const open = () => {
    setDraft({ RED: String(timings.RED), YELLOW: String(timings.YELLOW), GREEN: String(timings.GREEN) });
    setErrors({});
    dialogRef.current?.showModal();
  };
  const close = () => dialogRef.current?.close();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = { ...timings };
    const errs: Partial<Record<Light, string>> = {};
    for (const l of LIGHTS) {
      const r = validateSeconds(draft[l]);
      if (r.ok) next[l] = r.value;
      else errs[l] = r.error;
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    onSave(next);
    setSaved(true);
    close();
  };

  const hwText = {
    APPLIED: ["✓ Applied on Arduino", "text-sig-green"],
    PENDING: ["Waiting for Arduino confirmation…", "text-sig-yellow"],
    NO_ACK: ["No confirmation — is the updated firmware uploaded?", "text-destructive"],
    LOCAL: ["Saved locally — connect Arduino to apply.", "text-muted-foreground"],
  } as const;

  return (
    <section className="panel space-y-4" aria-label="Traffic light timing settings">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-mono text-xs tracking-widest text-muted-foreground">TRAFFIC LIGHT TIMING SETTINGS</h2>
          <p className="mt-1 text-sm">Customize how long each traffic-light phase lasts.</p>
        </div>
        <button onClick={open} className="rounded-lg bg-primary px-6 py-3 text-lg font-bold tracking-wide text-primary-foreground hover:opacity-90">
          ⚙ CHANGE TIMING
        </button>
      </div>

      {saved && (
        <p role="status" className="text-sm text-sig-green">
          Timing settings saved.
        </p>
      )}
      <ul className="grid gap-3 sm:grid-cols-3">
        {LIGHTS.map((l) => {
          const [txt, cls] = hwText[hardwareStatus(timings[l], acked[l], connected, sentAt, now)];
          return (
            <li key={l} className="flex items-center gap-3 rounded-lg bg-panel p-3">
              <span className={`h-5 w-5 shrink-0 rounded-full ${LAMP_CLS[l]}`} aria-hidden />
              <div>
                <div className="font-semibold">
                  {l}: {timings[l]} seconds
                </div>
                <div className={`text-xs ${cls}`}>{txt}</div>
              </div>
            </li>
          );
        })}
      </ul>

      <dialog
        ref={dialogRef}
        aria-labelledby="timing-title"
        className="m-auto w-[min(92vw,28rem)] rounded-2xl border-2 bg-card p-6 text-foreground backdrop:bg-background/80"
      >
        <form onSubmit={submit} noValidate className="space-y-4">
          <h3 id="timing-title" className="font-mono text-sm tracking-widest text-primary">
            TRAFFIC LIGHT TIMING
          </h3>
          {LIGHTS.map((l) => (
            <div key={l}>
              <label htmlFor={`t-${l}`} className="flex items-center gap-2 font-semibold">
                <span className={`h-4 w-4 rounded-full ${LAMP_CLS[l]}`} aria-hidden />
                {l} duration
              </label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  id={`t-${l}`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={60}
                  step={1}
                  value={draft[l]}
                  onChange={(e) => setDraft((d) => ({ ...d, [l]: e.target.value }))}
                  aria-invalid={!!errors[l]}
                  aria-describedby={errors[l] ? `e-${l}` : undefined}
                  className="w-24 rounded-lg border bg-panel px-3 py-2 font-mono text-lg"
                />
                <span className="text-sm text-muted-foreground">seconds (1–60)</span>
              </div>
              {errors[l] && (
                <p id={`e-${l}`} role="alert" className="mt-1 text-sm text-destructive">
                  {errors[l]}
                </p>
              )}
            </div>
          ))}
          <div className="flex flex-wrap gap-2 pt-2">
            <button type="submit" className="rounded-lg bg-primary px-4 py-2 font-bold text-primary-foreground hover:opacity-90">
              SAVE TIMINGS
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft({ RED: String(DEFAULT_TIMINGS.RED), YELLOW: String(DEFAULT_TIMINGS.YELLOW), GREEN: String(DEFAULT_TIMINGS.GREEN) });
                setErrors({});
              }}
              className="rounded-lg border px-4 py-2 font-semibold hover:bg-accent"
            >
              RESET DEFAULTS
            </button>
            <button type="button" onClick={close} className="rounded-lg border px-4 py-2 font-semibold hover:bg-accent">
              CANCEL
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
