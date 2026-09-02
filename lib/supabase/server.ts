import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { CookieOptions } from "@supabase/ssr";
import { requireSupabaseEnv } from "./config";

/**
 * Supabase server client — for Server Components, Server Actions, Route Handlers,
 * and RSC data fetching. This carries the user's session cookie so Postgres RLS
 * is enforced on every query. Never use the admin client for user data.
 */
export async function createSupabaseServerClient() {
  const { supabaseUrl, supabaseAnonKey } = requireSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server Components can't set cookies — safe to swallow.
        }
      },
    },
  });
}
