/** Server-only Supabase client (service-role key: bypasses RLS, never sent to browsers). */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** The service-role client, or null when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY aren't set. */
export function getServiceClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  client = isSupabaseConfigured()
    ? createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;
  return client;
}
