# TODAnaTo

A purpose-built web platform for running **one** tricycle operators and drivers association (TODA) in the Philippines: drivers, tricycles, members and officers, dues, daily operations and (later) ride-hailing through a mobile app that shares the same backend.

This is the rewrite of the original TODAnaTo PHP app. The old PHP code is kept on the `legacy-php` branch.

## Status: Phase 1 done

| Phase | Scope | Status |
|---|---|---|
| **1** | Auth, roles & permissions, dashboard, drivers, tricycles, TODA profile, online driver applications | **Done** |
| 2 | Finance & collections, reports, document centre, announcements, incidents | Database ready, screens next |
| 3 | Dispatch, live GPS map, rides, mobile app API, push notifications | Database ready |
| 4 | Advanced analytics, automated reminders, more integrations | — |

The database schema already covers every module in the spec (payments, dues, bookings, ride events, GPS pings, announcements, incidents, notifications, device tokens, settings), so later phases add screens and endpoints without reworking tables.

### What works now

- **Sign-in & accounts**: login/logout, forgot/reset password, forced password change for new accounts, change password, active-session list and sign-out, login history, account lockout after 5 failed attempts, rotating refresh tokens in an httpOnly cookie, 15-minute access tokens.
- **6 roles with editable permissions**: Super Administrator, President, Secretary, Treasurer, Dispatcher, Auditor. Super Admins tick/untick permissions per role in *Users & roles → Roles & permissions*. The President manages staff accounts; nobody can grant a role at or above their own.
- **One TODA**: everything belongs to the single TODA (its profile is under *TODA profile*). There is no screen or endpoint to add or remove associations; the `Association` table holds one row (`server/src/lib/toda.ts`), which keeps records scoped so later phases (finance, dispatch) fit without changes.
- **Dashboard**: drivers by status, pending applications, tricycles, active members, rides today (pending/ongoing/completed/cancelled), collections today, monthly income, outstanding dues, daily/weekly/monthly ride and finance charts (with a table view), pending approvals, expiring licenses/registrations/insurance/franchises, live driver availability, recent transactions and activity. All from the database; money figures only appear for roles with finance access.
- **Drivers**: register, edit, approve/reject applications, activate/deactivate/suspend (with reason and end date), archive, profile photo, document upload/verify/reject, CSV export, search/filter/sort/paginate, profile tabs for personal info, documents, tricycle, membership, payments, rides and activity history.
- **Tricycles**: register, edit, assign/reassign/unassign drivers (one driver per tricycle, history kept), operational / under maintenance / inactive, maintenance & repair log with costs, documents (OR/CR, MTOP, CTPL…), expiry tracking, full change history.
- **TODA profile**: name, accreditation, terminal, contact details and fees, officers with terms, membership list with status changes.
- **Audit log**: every sign-in, create, update (with before/after of the changed fields), approval, suspension, upload, verification, assignment and export.
- **Data privacy (RA 10173)**: birth date, address, emergency contact and email are masked for roles without `drivers.pii`; files are never public and are streamed only after a permission check; uploads are type- and magic-byte-checked; exports are logged.
- Light/dark mode, responsive down to phone width, loading/empty/error states, toasts, confirmation dialogs on sensitive actions.
- OpenAPI docs at `/api/docs`.

## Run it locally

Requirements: Node 20+, PostgreSQL 14+ (or Docker).

```bash
git clone https://github.com/owli-brr/todanato.git
cd todanato
docker compose up -d            # or use your own PostgreSQL
cp server/.env.example server/.env   # then set JWT_SECRET
npm run setup                   # installs, runs migrations, loads sample data
npm run dev:api                 # API on http://localhost:4000
npm run dev:web                 # web app on http://localhost:5173 (in a 2nd terminal)
```

Open http://localhost:5173. Demo accounts (password `Toda2026demo`; the login page has one-click buttons in dev):

| Email | Role | Sees |
|---|---|---|
| superadmin@todanato.ph | Super Administrator | everything, including roles & permissions |
| president@todanato.ph | President | runs the TODA, manages staff accounts |
| secretary@todanato.ph | Secretary | member, driver and tricycle records |
| treasurer@todanato.ph | Treasurer | collections and expenses |
| dispatcher@todanato.ph | Dispatcher | drivers on the road, no personal details |
| auditor@todanato.ph | Auditor | read-only |

`npm run db:seed` (in `server/`) wipes and reloads the sample data: one TODA (San Roque TODA, Antipolo City — rename it under *TODA profile*), 96 drivers, 81 tricycles, ~3,600 rides over 90 days, ~1,900 payments and 6 months of dues and expenses. All names and numbers are fictional. On Vercel the sample data reloads automatically when `SEED_VERSION` in `server/prisma/seed.ts` changes (unless `DEMO_MODE=false`).

### Driver applicants

Anyone can apply to join the TODA at `/apply` without an account and check the result at `/application-status` using their reference number and license number. Applications arrive as pending drivers (with the uploaded license, if any) that the TODA's officers approve or reject under **Drivers → Pending applications**. The public endpoints are under `/api/public` and are rate-limited.

### Finance

**Finance** (treasurer, president, auditor read-only) has four tabs:
- **Overview:** collections, expenses, net and unpaid dues, with a 12-month chart.
- **Payments:** every official receipt (`OR-YYYY-NNNNNN`). Recording a payment applies it to the driver's oldest unpaid charges of the same kind. A receipt is never edited; it is voided with a reason, optionally with a corrected receipt issued at the same time.
- **Dues and charges:** bill a month's dues to every member (safe to re-run), add one-off charges such as penalties, and waive a charge with a reason.
- **Expenses:** record, edit and delete TODA expenses.

Every action is in the audit log. Drivers see their balance, unpaid charges and recent receipts in the driver portal.

### Reports

**Reports** offers six reports: collections, income and expenses by month, unpaid dues by driver, expenses, the driver roster and the tricycle registry. Each can be filtered by date where that applies, printed, or exported to CSV. The CSV opens in Excel or Google Sheets and is protected against formula injection. Finance reports need `finance.read`, and every export is logged in the audit log.

### Driver portal

Once approved, a driver sets up their own sign-in at `/driver/activate` (application reference, license number, and the mobile number on file) and then signs in at `/driver/login` with their mobile number. The portal shows their status, membership and dues, assigned tricycle, documents, and reminders for anything expiring within 30 days. Staff can see whether a driver has set up the portal on the driver's profile and can reset it. Demo driver: `09170000001` / `Toda2026demo` (its password can't be changed in demo mode).

### Tests

With the API running on seeded data: `npm test`. The suite covers sign-in, the single-TODA rules, permission checks, PII masking, the full driver lifecycle (register → approve → upload/verify document → assign tricycle → suspend), privilege-escalation attempts, online driver applications, and audit logging.

### Production build

```bash
npm run build && NODE_ENV=production npm start
```

The API serves the built web app from `web/dist`, so one Node process and one PostgreSQL database are enough. Set a long random `JWT_SECRET`, put it behind HTTPS and back up the database daily. Uploaded files are stored in the database (`StoredFile` table), so no disk is needed.

### Deploying to Vercel

`vercel.json` builds the web app as static files and runs the API as one serverless function (`api/index.js`). On each deploy, `scripts/vercel-build.sh` applies migrations and loads the sample data if the database is empty.

1. In the Vercel project, open **Storage → Create Database → Neon (Postgres)** and connect it to the project. This sets `DATABASE_URL`.
2. Redeploy. The first deploy creates the tables and the demo data in their own Postgres schema, `toms` (set `DB_SCHEMA` to change it), so a database that already holds other tables is left alone.

On Vercel the app runs in **demo mode**: the shared `@todanato.ph` accounts can't be locked out, deactivated or have their password changed, and role permissions are read-only. Set `DEMO_MODE=false` to turn this off. The sign-in page lists the demo accounts only if `SHOW_DEMO_LOGINS=true` is set. `JWT_SECRET` is optional there (one is derived from the database URL); set it to rotate sign-ins.

## Layout

```
.
  server/                Express + Prisma API
    prisma/schema.prisma   full schema for all phases
    prisma/seed.ts         sample data
    src/lib/permissions.ts permission catalog and default role grants
    src/middleware/auth.ts authentication + association scoping helpers
    src/routes/            auth, users/roles, associations, drivers, vehicles, dashboard, files, audit
  web/                   React + TypeScript + Tailwind (shadcn-style components)
    src/pages/             screens
    src/components/ui/     reusable UI kit
```

## Notes for later phases

- Mobile apps will authenticate against `MobileAccount` (separate from admin `User`) with a different JWT audience, so a driver or passenger token can never call admin endpoints.
- Payments are never edited after posting; corrections void and replace (`Payment.replacesId`), and every ride status change is appended to `RideEvent`, so completed rides and receipts can't be silently falsified.
- Password-reset emails are logged to the console in development; plug in an email/SMS provider in Phase 2.
