import { PrismaClient } from '@prisma/client';

/** On Vercel, keep TOMS tables in their own Postgres schema ("toms") so they never clash with other
 * tables already in a shared database. Override with DB_SCHEMA; locally the URL is used as is. */
export function databaseUrl(url = process.env.DATABASE_URL) {
  const schema = process.env.DB_SCHEMA || (process.env.VERCEL ? 'toms' : '');
  if (!url || !schema) return url;
  const u = new URL(url);
  u.searchParams.set('schema', schema);
  return u.toString();
}

export const prisma = new PrismaClient({ datasourceUrl: databaseUrl() });
