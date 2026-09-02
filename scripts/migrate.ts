/**
 * Apply migrations from supabase/migrations/*.sql in order, tracking applied
 * versions in a schema_migrations table. Idempotent: skips already-applied.
 * Uses the DATABASE_URL (pooler) from .env over the direct PG connection.
 * Run:  npm run migrate
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

// Load .env (override ambient vars) — parse our own to be deterministic.
const envPath = resolve(process.cwd(), ".env");
try {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/.exec(line);
    if (m) process.env[m[1]] = m[2].replace(/\\r$/g, "").trim();
  }
} catch {
  /* no .env */
}

const dsn = process.env.DATABASE_URL ?? "";
if (!dsn) {
  console.error("DATABASE_URL not set in .env — cannot run migrations.");
  process.exit(1);
}

async function main() {
  const client = new pg.Client({ connectionString: dsn, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query(`create schema if not exists public;`);

  await client.query(`
    create table if not exists public.schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    );
  `);

  const dir = resolve(process.cwd(), "supabase", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  const { rows } = await client.query(`select version from public.schema_migrations`);
  const applied = new Set(rows.map((r) => r.version));

  let done = 0;
  for (const f of files) {
    if (applied.has(f)) {
      console.log(`  skip  ${f} (already applied)`);
      continue;
    }
    const sql = readFileSync(resolve(dir, f), "utf8");
    try {
      await client.query(sql);
      await client.query(`insert into public.schema_migrations (version) values ($1)`, [f]);
      console.log(`  apply ${f}`);
      done++;
    } catch (e: any) {
      console.error(`  FAIL  ${f}: ${e.message}`);
      await client.end();
      process.exit(1);
    }
  }

  console.log(`\nmigrations complete: ${done} applied of ${files.length}`);

  const { rows: tables } = await client.query(
    `select table_name from information_schema.tables where table_schema='public' order by table_name`,
  );
  console.log("public tables:", tables.map((r) => r.table_name).join(", "));

  await client.end();
}

main().catch((e) => {
  console.error("migrate error:", e.message);
  process.exit(1);
});
