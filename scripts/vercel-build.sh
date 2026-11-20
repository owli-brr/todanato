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
DATABASE_URL="$DIRECT_URL" npx prisma migrate deploy
DATABASE_URL="$DIRECT_URL" npx tsx prisma/seed.ts --if-empty
npm run build

cd ../web
if [ "${DEMO_MODE:-true}" != "false" ]; then export VITE_DEMO=true; fi
npm run build
