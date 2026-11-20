// One postgres.js client per process, created on first use so builds and previews never connect.
// prepare:false is required by Supabase's transaction-mode pooler.
import postgres from "postgres";

export type Sql = postgres.Sql;
export type Fragment = postgres.Fragment;
let client: Sql | null = null;

function getClient(): Sql {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set.");
    client = postgres(url, { prepare: false, max: 5, idle_timeout: 20, onnotice: () => {} });
  }
  return client;
}

// `sql` forwards to the lazily created client: `sql\`select 1\``, `sql.begin(...)`.
export const sql: Sql = new Proxy(function () {} as unknown as Sql, {
  apply: (_target, _this, args) => (getClient() as unknown as (...a: unknown[]) => unknown)(...args),
  get: (_target, prop) => {
    const c = getClient() as unknown as Record<string | symbol, unknown>;
    const value = c[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(c) : value;
  },
});

export async function closeDb(): Promise<void> {
  if (client) {
    const c = client;
    client = null;
    await c.end({ timeout: 5 });
  }
}
