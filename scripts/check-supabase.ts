/**
 * Supabase connection test.
 * Confirms the project is reachable, the service key authenticates, and
 * PostgREST can talk to the database. Run:  npm run check:supabase
 */
import { createClient } from "@supabase/supabase-js";

// Load .env explicitly and OVERRIDE process.env — deterministic regardless of
// any ambient shell vars (the shell session may export another project's keys).
// Node >= 20.12 loads .env; we then write the values in ourselves.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

try {
  const envPath = resolve(process.cwd(), ".env");
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/.exec(line);
    if (m) process.env[m[1]] = m[2].replace(/\\r$/g, "").trim();
  }
} catch {
  // .env missing — the checks below will surface the missing env clearly.
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";

let failed = false;

function report(name: string, ok: boolean, detail: string) {
  const mark = ok ? "✓ PASS" : "✗ FAIL";
  console.log(`  ${mark}  ${name}  ${detail}`);
  if (!ok) failed = true;
}

async function main() {
  console.log("── The Sidekick · Supabase connection test ──\n");

  if (!url) {
    report("NEXT_PUBLIC_SUPABASE_URL present", false, "env var missing");
  } else {
    report("NEXT_PUBLIC_SUPABASE_URL present", true, url.replace("https://", ""));

    // 1. Reachability + PostgREST up (service key returns the OpenAPI schema)
    try {
      const res = await fetch(`${url}/rest/v1/`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      const ok = res.ok || res.status === 404; // 404 = PostgREST alive, path-only
      report("PostgREST reachable + key auth", ok, `HTTP ${res.status}`);
      if (res.status === 401 || res.status === 403) {
        report("service key authenticates (not 401/403)", false, `got ${res.status}`);
      }
    } catch (e) {
      report("PostgREST reachable + key auth", false, String(e));
    }

    // 2. Auth health endpoint — informational. Not every project exposes it
    // (a 401/404 here is config, not a wiring failure), so it never fails the run.
    try {
      const res = await fetch(`${url}/auth/v1/health`);
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { version?: string };
        console.log(`  ℹ  Auth health endpoint  ${body.version ? `v${body.version}` : "200"}`);
      } else {
        console.log(`  ℹ  Auth health endpoint  HTTP ${res.status} (informational)`);
      }
    } catch {
      console.log("  ℹ  Auth health endpoint  unreachable (informational)");
    }

    // 3. Real authenticated round-trip through supabase-js (schema-agnostic).
    // The schema is currently fresh (no app tables yet), so PostgREST returning
    // "could not find the table" (PGRST204 / PGRST205) is EXPECTED and PROVES it
    // reached Postgres with valid auth. A 401/auth error is the real failure.
    try {
      const sb = createClient(url, key);
      const { error } = await sb.from("sessions").select("session_id").limit(1);
      const reachedDb =
        !error || /(could not find|does not exist|schema cache)/i.test(error.message);
      report(
        "supabase-js authenticated round-trip",
        reachedDb,
        error ? `${error.code} reached DB (auth OK)` : "query ran",
      );
    } catch (e) {
      report("supabase-js authenticated round-trip", false, String(e));
    }
  }

  console.log("");
  if (failed) {
    console.log("RESULT: ✗ one or more checks failed — fix .env / project.");
    process.exit(1);
  } else {
    console.log("RESULT: ✓ Supabase is wired and reachable.");
    process.exit(0);
  }
}

main();
