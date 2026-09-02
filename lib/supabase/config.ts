/**
 * Central, typed access to Supabase env vars.
 * Never read `process.env` directly in components — import from here.
 *
 * Because `env` is evaluated at module import time, this file self-loads `.env`
 * (overriding ambient shell vars, which often carry another project's keys) so
 * `env` is correct no matter who imports it first — including standalone tsx
 * scripts that run outside the Next.js runtime.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

try {
  const envPath = resolve(process.cwd(), ".env");
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/.exec(line);
    if (m) process.env[m[1]] = m[2].replace(/\\r$/g, "").trim();
  }
} catch {
  /* no .env — rely on ambient */
}

export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
} as const;

/** Throw a clear error if a required var is missing (fails fast in build). */
export function requireSupabaseEnv() {
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    throw new Error(
      "Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.",
    );
  }
  return env;
}
