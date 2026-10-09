import { useCallback, useEffect, useRef, useState } from "react";
import { parseMessage, splitBuffer, type ArduinoEvent, type Light, type Status } from "@/lib/blindway";

/* eslint-disable @typescript-eslint/no-explicit-any */
type SerialPortLike = any;

export const BAUD_RATE = 9600;
const MAX_LOG = 300;

export interface SerialLogLine {
  id: number;
  time: string;
  text: string;
}

export interface ReadingSnapshot {
  light: Light | null;
  distance: number | null;
  status: Status | null;
}

export function isWebSerialSupported() {
  return typeof navigator !== "undefined" && "serial" in navigator;
}

export function useArduinoSerial(opts: {
  onEvent?: (e: ArduinoEvent, snap: ReadingSnapshot) => void;
  onLight?: (l: Light, snap: ReadingSnapshot) => void;
  onTimingAck?: (phase: Light, seconds: number) => void;
} = {}) {
  const [lastDataAt, setLastDataAt] = useState<number | null>(null);
  const writeChain = useRef<Promise<unknown>>(Promise.resolve());
  const [isConnected, setConnected] = useState(false);
  const [port, setPort] = useState<SerialPortLike | null>(null);
  const [portLabel, setPortLabel] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const [messages, setMessages] = useState<SerialLogLine[]>([]);
  const [light, setLight] = useState<Light | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [event, setEvent] = useState<ArduinoEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const portRef = useRef<SerialPortLike | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<string> | null>(null);
  const closedRef = useRef<Promise<void> | null>(null);
  const snap = useRef<ReadingSnapshot>({ light: null, distance: null, status: null });
  const idRef = useRef(0);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const ingest = useCallback((raw: string) => {
    const text = raw.trim();
    if (!text) return;
    setLastMessage(text);
    setMessages((m) => {
      const next = [...m, { id: ++idRef.current, time: new Date().toLocaleTimeString(), text }];
      return next.length > MAX_LOG ? next.slice(-MAX_LOG) : next;
    });
    for (const p of parseMessage(text)) {
      if (p.kind === "TIMING_ACK") {
        optsRef.current.onTimingAck?.(p.phase, p.seconds);
        continue;
      }
      if (p.kind !== "EVENT") setLastDataAt(Date.now());
      if (p.kind === "LIGHT") {
        const changed = snap.current.light !== p.value;
        snap.current.light = p.value;
        setLight(p.value);
        if (changed) optsRef.current.onLight?.(p.value, { ...snap.current });
      } else if (p.kind === "DISTANCE") {
        snap.current.distance = p.value;
        setDistance(p.value);
      } else if (p.kind === "STATUS") {
        snap.current.status = p.value;
        setStatus(p.value);
      } else {
        setEvent(p.value);
        optsRef.current.onEvent?.(p.value, { ...snap.current });
      }
    }
  }, []);

  const cleanup = useCallback(async () => {
    try {
      await readerRef.current?.cancel();
    } catch {}
    try {
      await closedRef.current;
    } catch {}
    try {
      await portRef.current?.close();
    } catch {}
    readerRef.current = null;
    closedRef.current = null;
    portRef.current = null;
    setPort(null);
    setConnected(false);
  }, []);

  const readLoop = useCallback(
    async (p: SerialPortLike) => {
      const decoder = new TextDecoderStream();
      closedRef.current = p.readable.pipeTo(decoder.writable).catch(() => {});
      const reader = decoder.readable.getReader();
      readerRef.current = reader;
      let buffer = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            buffer += value;
            const { lines, rest } = splitBuffer(buffer);
            buffer = rest;
            lines.forEach(ingest);
          }
        }
      } catch {
        setError("Arduino disconnected");
      } finally {
        try {
          reader.releaseLock();
        } catch {}
      }
    },
    [ingest],
  );

  const connect = useCallback(async () => {
    setError(null);
    if (!isWebSerialSupported()) {
      setError(
        "Web Serial is not supported in this browser. Please use a supported Chromium-based browser such as Google Chrome or Microsoft Edge.",
      );
      return;
    }
    if (portRef.current) await cleanup();
    let p: SerialPortLike;
    try {
      p = await (navigator as any).serial.requestPort();
    } catch {
      return; // user cancelled the chooser
    }
    try {
      await p.open({ baudRate: BAUD_RATE });
    } catch (e: any) {
      setError(`Could not connect to Arduino. ${e?.message ?? ""}`.trim());
      return;
    }
    portRef.current = p;
    setPort(p);
    const info = p.getInfo?.() ?? {};
    setPortLabel(
      info.usbVendorId
        ? `USB ${info.usbVendorId.toString(16).padStart(4, "0")}:${(info.usbProductId ?? 0).toString(16).padStart(4, "0")}${info.usbVendorId === 0x2341 ? " (Arduino)" : ""}`
        : "Serial port",
    );
    setConnected(true);
    void readLoop(p);
  }, [cleanup, readLoop]);

  /** Write newline-terminated lines over the existing port (serialised). */
  const send = useCallback((lines: string[]): Promise<boolean> => {
    const job = writeChain.current.then(async () => {
      const p = portRef.current;
      if (!p?.writable) return false;
      const w = p.writable.getWriter();
      try {
        const enc = new TextEncoder();
        for (const l of lines) await w.write(enc.encode(l + "\n"));
        return true;
      } catch {
        setError("Could not send data to the Arduino.");
        return false;
      } finally {
        w.releaseLock();
      }
    });
    writeChain.current = job.catch(() => {});
    return job;
  }, []);

  const disconnect = useCallback(async () => {
    await cleanup();
    setError(null);
  }, [cleanup]);

  useEffect(() => {
    if (!isWebSerialSupported()) return;
    const serial = (navigator as any).serial;
    const onDisconnect = (e: any) => {
      if (e.target === portRef.current || e.port === portRef.current) {
        setError("Arduino disconnected");
        void cleanup();
      }
    };
    serial.addEventListener("disconnect", onDisconnect);
    return () => {
      serial.removeEventListener("disconnect", onDisconnect);
      void cleanup();
    };
  }, [cleanup]);

  const reset = useCallback(() => {
    snap.current = { light: null, distance: null, status: null };
    setLight(null);
    setDistance(null);
    setStatus(null);
    setEvent(null);
    setLastMessage(null);
    setLastDataAt(null);
  }, []);

  return {
    connect,
    disconnect,
    ingest,
    send,
    lastDataAt,
    reset,
    clearMessages: () => setMessages([]),
    isConnected,
    port,
    portLabel,
    baudRate: BAUD_RATE,
    lastMessage,
    messages,
    light,
    distance,
    status,
    event,
    error,
  };
}
