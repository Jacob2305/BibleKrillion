import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveHostInfo, LiveMe, LiveRealtime, LiveSnapshot } from "../../lib/game/live-types";
import { ApiError } from "../lib/api";
import { liveApi } from "./liveApi";

export type LiveSource = { kind: "player"; token: string } | { kind: "host"; token: string } | { kind: "screen"; code: string };

/** live = realtime socket connected; polling = no socket (yet), refreshing on a timer. */
export type Connection = "connecting" | "live" | "polling";

export interface LiveData {
  snapshot: LiveSnapshot;
  me?: LiveMe;
  host?: LiveHostInfo;
  realtime: LiveRealtime | null;
}

interface Options {
  /** A response already in hand (from join/create), so the first paint needs no extra request. */
  initial?: LiveData;
  /** Host and projector: refresh every couple of seconds in the lobby and while answers come in. */
  watchCounts?: boolean;
  /** The room or seat is gone (401/403/404/410): stop and let the screen explain. */
  onFatal?: (err: ApiError) => void;
}

const FATAL = new Set([401, 403, 404, 410]);

async function fetchFor(source: LiveSource): Promise<LiveData> {
  if (source.kind === "player") return liveApi.stateAsPlayer(source.token);
  if (source.kind === "host") return liveApi.host(source.token, "state");
  return liveApi.stateByCode(source.code);
}

/**
 * Keeps a room's state fresh: realtime broadcasts when available, polling as a
 * fallback (and a slow safety net), a refresh whenever the phone wakes up.
 * Snapshots older than the one on screen are ignored.
 */
export function useLiveRoom(source: LiveSource, opts: Options = {}) {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(opts.initial?.snapshot ?? null);
  const [me, setMe] = useState<LiveMe | undefined>(opts.initial?.me);
  const [host, setHost] = useState<LiveHostInfo | undefined>(opts.initial?.host);
  const [realtime, setRealtime] = useState<LiveRealtime | null | undefined>(opts.initial ? opts.initial.realtime : undefined);
  const [connection, setConnection] = useState<Connection>(opts.initial && !opts.initial.realtime ? "polling" : "connecting");
  const [error, setError] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  /** server clock − local clock, ms. */
  const offsetRef = useRef(opts.initial ? opts.initial.snapshot.serverNow - Date.now() : 0);
  const sourceKey = source.kind === "screen" ? `s:${source.code}` : `${source.kind}:${source.token}`;
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const onFatalRef = useRef(opts.onFatal);
  onFatalRef.current = opts.onFatal;

  const applySnapshot = useCallback((next: LiveSnapshot) => {
    offsetRef.current = next.serverNow - Date.now();
    setSnapshot((prev) => (!prev || prev.code !== next.code || next.version >= prev.version ? next : prev));
  }, []);

  /** Take any full response (state, host action, join). */
  const accept = useCallback(
    (data: LiveData) => {
      applySnapshot(data.snapshot);
      if (data.me) setMe(data.me);
      if (data.host) setHost(data.host);
      setRealtime((prev) => (prev && data.realtime && prev.topic === data.realtime.topic ? prev : data.realtime));
      if (!data.realtime) setConnection("polling");
      setError(null);
    },
    [applySnapshot],
  );

  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      accept(await fetchFor(sourceRef.current));
    } catch (err) {
      if (err instanceof ApiError && FATAL.has(err.status)) {
        setStopped(true);
        onFatalRef.current?.(err);
      } else {
        setError("Connection hiccup. Reconnecting…");
      }
    } finally {
      inFlight.current = false;
    }
  }, [accept]);

  // First load (unless join/create already gave us the state).
  const loadedFor = useRef<string | null>(opts.initial ? sourceKey : null);
  useEffect(() => {
    if (loadedFor.current === sourceKey) return;
    loadedFor.current = sourceKey;
    setStopped(false);
    void refresh();
  }, [sourceKey, refresh]);

  // Realtime: listen on the room's private broadcast channel.
  const topic = realtime?.topic;
  useEffect(() => {
    if (!realtime || stopped) return;
    let cancelled = false;
    let cleanup = () => {};
    void import("@supabase/supabase-js")
      .then(({ createClient }) => {
        if (cancelled) return;
        const client = createClient(realtime.url, realtime.key, { auth: { persistSession: false, autoRefreshToken: false } });
        const channel = client
          .channel(realtime.topic, { config: { private: true } })
          .on("broadcast", { event: "state" }, ({ payload }) => applySnapshot(payload as LiveSnapshot))
          .subscribe((status) => {
            if (status === "SUBSCRIBED") {
              setConnection("live");
              void refresh(); // catch up on anything sent while we were connecting
            } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
              setConnection("polling");
            }
          });
        cleanup = () => {
          void client.removeChannel(channel);
        };
      })
      .catch(() => setConnection("polling"));
    return () => {
      cancelled = true;
      cleanup();
    };
    // Reconnect only when the topic changes (the realtime object itself is recreated on every response).
  }, [topic, stopped]);

  // Polling: fast without a socket (or for counts), slow safety net with one.
  const phase = snapshot?.phase;
  const counting = Boolean(opts.watchCounts) && (phase === "lobby" || phase === "question");
  const delay = connection === "live" ? (counting ? 2000 : 30_000) : counting ? 2000 : 3000;
  useEffect(() => {
    if (stopped) return;
    const id = window.setInterval(() => void refresh(), delay);
    return () => window.clearInterval(id);
  }, [delay, refresh, stopped]);

  // Phones sleep; refresh the moment the screen comes back on or the network returns.
  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === "visible" && !stopped) void refresh();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [refresh, stopped]);

  /** Convert a server timestamp (e.g. a deadline) to this device's clock. */
  const toLocal = useCallback((serverMs: number) => serverMs - offsetRef.current, []);

  return { snapshot, me, host, connection, error, refresh, accept, toLocal };
}
