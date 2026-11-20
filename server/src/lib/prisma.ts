import { Prisma, PrismaClient } from '@prisma/client';

/** On Vercel, keep TODAnaTo tables in their own Postgres schema ("toms") so they never clash with other
 * tables already in a shared database. Override with DB_SCHEMA; locally the URL is used as is. */
export function databaseUrl(url = process.env.DATABASE_URL) {
  const schema = process.env.DB_SCHEMA || (process.env.VERCEL ? 'toms' : '');
  if (!url || !schema) return url;
  const u = new URL(url);
  u.searchParams.set('schema', schema);
  return u.toString();
}

const url = databaseUrl();
export const DB_SCHEMA = (url && new URL(url).searchParams.get('schema')) || 'public';

/** Schema-qualified table name for raw SQL (Prisma's own queries qualify names automatically). */
export const table = (name: string) => Prisma.raw(`"${DB_SCHEMA.replace(/"/g, '')}"."${name}"`);

export const prisma = new PrismaClient({ datasourceUrl: url });
