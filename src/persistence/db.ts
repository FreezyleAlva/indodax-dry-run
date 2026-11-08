// src/persistence/db.ts
import path from "node:path";
import { MIGRATIONS } from "./migrations.generated";

export type Row = Record<string, unknown>;

export interface Queryable {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  kind: "pg" | "pglite";
}

class PgDb implements Db {
  kind = "pg" as const;
  constructor(private pool: import("pg").Pool) {}
  async query<T extends Row = Row>(sql: string, params: unknown[] = []) {
    const r = await this.pool.query(sql, params);
    return { rows: r.rows as T[] };
  }
  async tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const q: Queryable = { query: async <R extends Row = Row>(sql: string, params: unknown[] = []) => ({ rows: (await client.query(sql, params)).rows as R[] }) };
      const out = await fn(q);
      await client.query("COMMIT");
      return out;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }
  async close() {
    await this.pool.end();
  }
}

class PgliteDb implements Db {
  kind = "pglite" as const;
  constructor(private pg: import("@electric-sql/pglite").PGlite) {}
  async query<T extends Row = Row>(sql: string, params: unknown[] = []) {
    const r = await this.pg.query(sql, params);
    return { rows: r.rows as T[] };
  }
  async tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    return this.pg.transaction(async (t) => {
      const q: Queryable = { query: async <R extends Row = Row>(sql: string, params: unknown[] = []) => ({ rows: (await t.query(sql, params)).rows as R[] }) };
      return fn(q);
    });
  }
  async close() {
    await this.pg.close();
  }
}

export async function openPg(url: string): Promise<Db> {
  const { Pool, types } = await import("pg");
  types.setTypeParser(20, (v: string) => Number(v));
  const local = /localhost|127\.0\.0\.1/.test(url);
  const pool = new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000, ssl: local ? undefined : { rejectUnauthorized: true } });
  return new PgDb(pool);
}

export async function openPglite(dir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = dir ? new PGlite(dir) : new PGlite();
  await pg.waitReady;
  return new PgliteDb(pg);
}

let shared: Promise<Db> | null = null;

export function getDb(): Promise<Db> {
  if (!shared) {
    const url = process.env.DATABASE_URL;
    if (url) shared = openPg(url);
    else if (process.env.BOT_ENV === "production" || process.env.VERCEL === "1") shared = Promise.reject(new Error("DATABASE_URL_MISSING"));
    else shared = openPglite(path.join(process.cwd(), ".data", "pglite"));
    shared.catch(() => { shared = null; });
  }
  return shared;
}

const applied = new WeakSet<object>();

export async function ensureSchema(db: Db, list: { version: string; sql: string }[] = MIGRATIONS): Promise<string[]> {
  if (applied.has(db)) return [];
  await db.query("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  const done = new Set((await db.query<{ version: string }>("SELECT version FROM schema_migrations")).rows.map((r) => r.version));
  const ran: string[] = [];
  for (const m of list) {
    const f = m.version;
    if (done.has(f)) continue;
    const sql = m.sql;
    await db.tx(async (q) => {
      for (const stmt of splitSql(sql)) await q.query(stmt);
      await q.query("INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING", [f]);
    });
    ran.push(f);
  }
  applied.add(db);
  return ran;
}

export function splitSql(sql: string): string[] {
  return sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
