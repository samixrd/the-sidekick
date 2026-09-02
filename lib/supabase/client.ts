import { createBrowserClient } from "@supabase/ssr";
import { requireSupabaseEnv } from "./config";

/**
 * Supabase browser client — for Client Components.
 * Uses the anon/publishable key only. Safe to import in the browser.
 */
export function createBrowserSupabaseClient() {
  const { supabaseUrl, supabaseAnonKey } = requireSupabaseEnv();
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
