import { createClient } from "@supabase/supabase-js";
import { env } from "./config";

/**
 * Admin client — bypasses RLS (service role key). Server-only.
 * Use ONLY for elevated backend ops: creating users, indexer writes,
 * scoring refreshes, migrations. NEVER import into a client component,
 * and never route user-scoped data through it.
 */
export function createAdminSupabaseClient() {
  if (!env.supabaseServiceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set.");
  }
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
