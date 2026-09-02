"use client";

import { useEffect, useState } from "react";

/**
 * Surfaces missing Supabase env config in the slot where the page expects data.
 * This is a client wrapper so it can read process.env.Next.js-inline vars and
 * show a helpful message if the marketplace page can't reach Supabase.
 */
export function RequireSupabaseEnv() {
  const [ok] = useState(
    () => Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  );
  useEffect(() => {
    // placeholder: intentionally minimal
  }, []);
  if (ok) return null;
  return (
    <div className="rounded border border-border bg-surface p-4 text-sm text-muted">
      Supabase env vars not configured ({`NEXT_PUBLIC_SUPABASE_URL`}/anon). Indexed data unavailable.
    </div>
  );
}
