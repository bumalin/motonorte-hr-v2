// The ONLY query path for the app (ADR-010). Connects as the non-owner `app_user`, so RLS applies.
import postgres from "postgres";

export type Tx = postgres.TransactionSql;

/** bigint (int8, oid 20) → JS number, exact; throws instead of silently losing precision beyond 2^53. */
export const PG_TYPES = {
  bigint: {
    to: 20, from: [20],
    serialize: (x: number | bigint) => String(x),
    parse: (x: string) => {
      const n = Number(x);
      if (!Number.isSafeInteger(n)) throw new Error(`bigint ${x} exceeds the safe integer range`);
      return n;
    },
  },
};

const g = globalThis as unknown as { __mnSql?: postgres.Sql };

function db(): postgres.Sql {
  if (!g.__mnSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    g.__mnSql = postgres(url, { max: 5, onnotice: () => {}, types: PG_TYPES });
  }
  return g.__mnSql;
}

/** Runs `fn` in a transaction as `userId`; every RLS policy sees this user via app_role(). */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await db().begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    return fn(tx);
  })) as T;
}

/**
 * No user context. Only for the auth_* SECURITY DEFINER functions, and only from lib/auth and app/login.
 * Safe by construction: with no app.user_id, app_role() is null and every RLS policy denies.
 */
export async function withAnon<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await db().begin(async (tx) => {
    await tx`select set_config('app.user_id', '', true)`;
    return fn(tx);
  })) as T;
}
