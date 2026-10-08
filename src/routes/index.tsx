import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useArduinoSerial, isWebSerialSupported, type ReadingSnapshot } from "@/hooks/useArduinoSerial";
import { deriveSafety, VOICE, type ArduinoEvent, type Light } from "@/lib/blindway";

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
  ["LIGHT:RED", "STATUS:SAFE", "DISTANCE:25"],
  ["LIGHT:YELLOW", "STATUS:SAFE", "DISTANCE:20"],
  ["LIGHT:GREEN", "DISTANCE:18", "STATUS:SAFE", "EVENT:GREEN_SAFE"],
  ["LIGHT:GREEN", "DISTANCE:5", "STATUS:DANGER", "EVENT:VEHICLE_DETECTED"],
  ["LIGHT:GREEN", "DISTANCE:19", "STATUS:SAFE", "EVENT:GREEN_SAFE"],
];

function Index() {
  const [muted, setMuted] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [demo, setDemo] = useState(false);
  const [supported, setSupported] = useState(true);
  const [monitorOpen, setMonitorOpen] = useState(true);
  const lastSpoken = useRef<ArduinoEvent | null>(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const hid = useRef(0);

  useEffect(() => setSupported(isWebSerialSupported()), []);

  const speak = useCallback((text: string, force = false) => {
    if ((mutedRef.current && !force) || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  }, []);

  const addHistory = useCallback((icon: string, label: string, s: ReadingSnapshot) => {
    setHistory((h) =>
      [{ id: ++hid.current, time: new Date().toLocaleTimeString(), icon, label, distance: s.distance, light: s.light }, ...h].slice(0, 50),
    );
  }, []);

  const serial = useArduinoSerial({
    onEvent: (e, s) => {
      if (lastSpoken.current === e) return; // only announce when the event changes
      lastSpoken.current = e;
      speak(VOICE[e]);
      if (e === "GREEN_SAFE") addHistory("🟢", "Green light - Road clear", s);
      else addHistory("🚨", "Vehicle detected", s);
    },
    onLight: (l, s) => {
      if (l !== "GREEN") lastSpoken.current = null;
      if (l === "RED") addHistory("🔴", "Red light - Stop", s);
      if (l === "YELLOW") addHistory("🟡", "Yellow light - Wait", s);
    },
  });

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

  const safety = deriveSafety(serial.light, serial.status);

  return (
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-6">
      {/* Header */}
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

      {/* Connection */}
      <section className="panel flex flex-wrap items-center gap-6" aria-label="Arduino connection">
        <Stat label="Arduino Connection">
          <span className={serial.isConnected ? "text-sig-green" : "text-destructive"}>
            ● {serial.isConnected ? "CONNECTED" : "DISCONNECTED"}
          </span>
        </Stat>
        <Stat label="COM Port">{serial.isConnected ? serial.portLabel : "—"}</Stat>
        <Stat label="Baud Rate">{serial.baudRate}</Stat>
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
          <p className="w-full font-mono text-xs text-muted-foreground">Latest raw message: &gt; {serial.lastMessage}</p>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-[260px_1fr_300px]">
        <TrafficLight light={serial.light} />
        <SafetyCard safety={safety} />
        <div className="space-y-5">
          <DistanceCard distance={serial.distance} />
          <section className="panel space-y-3" aria-label="Voice controls">
            <h2 className="font-mono text-xs tracking-widest text-muted-foreground">VOICE</h2>
            <button onClick={() => speak("BLINDWAY voice test. It's OK to move.", true)} className="w-full rounded-lg bg-secondary px-4 py-3 font-semibold hover:bg-accent">
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
        <p className="mt-3 text-xs text-muted-foreground">Close the Arduino IDE Serial Monitor first — only one program can use the port at a time. All data stays in your browser.</p>
      </section>
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

function TrafficLight({ light }: { light: Light | null }) {
  const lamps: { l: Light; cls: string }[] = [
    { l: "RED", cls: "bg-sig-red text-sig-red" },
    { l: "YELLOW", cls: "bg-sig-yellow text-sig-yellow" },
    { l: "GREEN", cls: "bg-sig-green text-sig-green" },
  ];
  const caption = { RED: "🔴 RED — STOP", YELLOW: "🟡 YELLOW — WAIT", GREEN: "🟢 GREEN — CHECK ROAD" };
  return (
    <section className="panel flex flex-col items-center gap-4" aria-label="Traffic light">
      <div className="flex flex-col gap-4 rounded-3xl border-4 bg-panel p-5">
        {lamps.map(({ l, cls }) => (
          <div
            key={l}
            aria-label={`${l} lamp ${light === l ? "on" : "off"}`}
            className={`h-20 w-20 rounded-full transition-all duration-300 ${cls} ${light === l ? "lamp-glow opacity-100" : "opacity-15"}`}
          />
        ))}
      </div>
      <p className="text-center text-lg font-bold">{light ? caption[light] : "Waiting for signal…"}</p>
    </section>
  );
}

function SafetyCard({ safety }: { safety: ReturnType<typeof deriveSafety> }) {
  const view = {
    SAFE: { cls: "border-sig-green bg-sig-green/15", title: "🟢 SAFE TO CROSS", sub: ["It's OK to move"] },
    DANGER: { cls: "border-destructive bg-destructive/25 danger-pulse", title: "🚨 DANGER", sub: ["VEHICLE DETECTED", "DO NOT CROSS"] },
    STOP: { cls: "border-sig-red bg-sig-red/10", title: "🔴 STOP", sub: ["Wait for green"] },
    WAIT: { cls: "border-sig-yellow bg-sig-yellow/10", title: "🟡 WAIT", sub: ["Light is changing"] },
    UNKNOWN: { cls: "border-border bg-card", title: "— NO DATA —", sub: ["Connect the Arduino to begin"] },
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
