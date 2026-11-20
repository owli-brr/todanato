#!/usr/bin/env bash
# Build step for Vercel (see vercel.json). Runs migrations and seeds sample data on the first deploy.
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set."
  echo "In Vercel, open the project > Storage > Create Database > Neon (Postgres), connect it to this project, then redeploy."
  exit 1
fi

cd server
npx prisma generate
# Migrations need a direct (non-pooled) connection; Neon on Vercel provides DATABASE_URL_UNPOOLED.
DIRECT_URL="${DATABASE_URL_UNPOOLED:-${POSTGRES_URL_NON_POOLING:-$DATABASE_URL}}"
# TOMS keeps its tables in their own schema (default "toms"), so a database that already holds
# other tables (for example from the old PHP site) is left untouched.
SCHEMA="${DB_SCHEMA:-toms}"
DIRECT_URL="$(node -e 'const u=new URL(process.argv[1]);u.searchParams.set("schema",process.argv[2]);console.log(u.toString())' "$DIRECT_URL" "$SCHEMA")"
echo "Using database schema \"$SCHEMA\""
DATABASE_URL="$DIRECT_URL" npx prisma migrate deploy
DATABASE_URL="$DIRECT_URL" npx tsx prisma/seed.ts --if-empty
npm run build

cd ../web
# The sign-in page lists the demo accounts only when SHOW_DEMO_LOGINS=true is set in Vercel.
if [ "${SHOW_DEMO_LOGINS:-false}" = "true" ]; then export VITE_DEMO=true; fi
npm run build
