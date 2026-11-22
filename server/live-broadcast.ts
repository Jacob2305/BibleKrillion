/**
 * Pushes room snapshots to phones over Supabase Realtime broadcast (private
 * channels: browsers may listen, only this service-role client may send).
 * Without Supabase, broadcasting is off and the clients poll /api/live instead.
 */
import type { LiveRealtime, LiveSnapshot } from "../lib/game/live-types.js";
import { getServiceClient } from "./supabase.js";

export const SNAPSHOT_EVENT = "state";

export interface Broadcaster {
  /** Where browsers should listen, or null when they should poll. */
  realtimeFor(roomId: string): LiveRealtime | null;
  send(roomId: string, snapshot: LiveSnapshot): Promise<void>;
}

export const topicFor = (roomId: string) => `room:${roomId}`;

export const noBroadcast: Broadcaster = {
  realtimeFor: () => null,
  send: async () => {},
};

class SupabaseBroadcaster implements Broadcaster {
  constructor(
    private readonly url: string,
    private readonly anonKey: string,
  ) {}

  realtimeFor(roomId: string): LiveRealtime {
    return { url: this.url, key: this.anonKey, topic: topicFor(roomId) };
  }

  async send(roomId: string, snapshot: LiveSnapshot) {
    const db = getServiceClient();
    if (!db) return;
    const channel = db.channel(topicFor(roomId), { config: { private: true } });
    try {
      await channel.httpSend(SNAPSHOT_EVENT, snapshot, { timeout: 5000 });
    } catch (err) {
      // Never fail a host action over this: phones re-sync by polling.
      console.error("[live] broadcast failed:", err instanceof Error ? err.message : err);
    } finally {
      void db.removeChannel(channel);
    }
  }
}

let defaultBroadcaster: Broadcaster | undefined;

export function getBroadcaster(): Broadcaster {
  if (defaultBroadcaster) return defaultBroadcaster;
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  defaultBroadcaster = url && anonKey && getServiceClient() ? new SupabaseBroadcaster(url.replace(/\/+$/, ""), anonKey) : noBroadcast;
  return defaultBroadcaster;
}
