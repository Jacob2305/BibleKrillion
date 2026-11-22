/**
 * Per-device conveniences in localStorage. Every access is guarded: private
 * windows or blocked storage just mean nothing is remembered (the server still
 * enforces one Daily attempt per device id it has seen).
 */
import type { ResultTier } from "../../lib/game/scoring";

const PREFIX = "bibledive:";

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

let memoryDeviceId: string | null = null;

/** A random id for this browser, created once. */
export function getDeviceId(): string {
  const existing = read<string>("device");
  if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
  const id =
    memoryDeviceId ??
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
  memoryDeviceId = id;
  write("device", id);
  return id;
}

export const getNickname = (): string => read<string>("nickname") ?? "";
export const setNickname = (name: string): void => write("nickname", name);

export interface DailyRecord {
  day: string;
  status: "playing" | "done";
  /** Sealed dive token, to fetch results again. */
  token: string;
  total?: number;
  tiers?: ResultTier[];
}

export const getDailyRecord = (day: string): DailyRecord | null => read<DailyRecord>(`daily:${day}`);
export const setDailyRecord = (record: DailyRecord): void => write(`daily:${record.day}`, record);

// ───────────── Live rooms ─────────────

function remove(key: string): void {
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    /* storage unavailable */
  }
}

/** This phone's seat in a room, so a refresh or dropped connection rejoins as the same player. */
export interface LiveSeat {
  code: string;
  token: string;
  nickname: string;
  at: number;
}

export const getLiveSeat = (code: string): LiveSeat | null => read<LiveSeat>(`seat:${code}`);
export const setLiveSeat = (seat: LiveSeat): void => write(`seat:${seat.code}`, seat);
export const clearLiveSeat = (code: string): void => remove(`seat:${code}`);

/** Rooms this browser is hosting (newest first, kept for 12 hours). */
export interface HostedRoom {
  code: string;
  token: string;
  at: number;
}

const HOSTED_TTL_MS = 12 * 60 * 60 * 1000;

export function getHostedRooms(): HostedRoom[] {
  const rooms = read<HostedRoom[]>("hosting") ?? [];
  return Array.isArray(rooms) ? rooms.filter((r) => r && typeof r.code === "string" && Date.now() - r.at < HOSTED_TTL_MS) : [];
}

export function addHostedRoom(room: HostedRoom): void {
  write("hosting", [room, ...getHostedRooms().filter((r) => r.code !== room.code)].slice(0, 5));
}

export function removeHostedRoom(code: string): void {
  write("hosting", getHostedRooms().filter((r) => r.code !== code));
}
