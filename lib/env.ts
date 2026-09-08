/**
 * Deterministic env loading for standalone tsx scripts AND GitHub Actions.
 *
 * Precedence: real environment variables (Actions secrets / exported shell)
 * win; a local `.env` file (if present) only fills in what's missing. This
 * replaces the old per-script loaders that OVERWROTE ambient vars from `.env`
 * — on CI there is no .env, and locally nothing changes.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadEnv(): void {
  try {
    const envPath = resolve(process.cwd(), ".env");
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/.exec(line);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/\r$/g, "").trim();
    }
  } catch {
    /* no .env — rely on the ambient environment (CI) */
  }
}

/** envGet with the same precedence, for call sites that used a regex reader. */
export function envGet(key: string): string {
  loadOnce();
  return (process.env[key] ?? "").trim();
}

let loaded = false;
function loadOnce() {
  if (!loaded) { loaded = true; loadEnv(); }
}
