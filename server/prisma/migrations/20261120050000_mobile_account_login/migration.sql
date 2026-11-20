-- Driver portal sign-in: lockout, last login, and a token version for sign-out-everywhere.
ALTER TABLE "MobileAccount" ADD COLUMN "failedLogins" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MobileAccount" ADD COLUMN "lockedUntil" TIMESTAMP(3);
ALTER TABLE "MobileAccount" ADD COLUMN "lastLoginAt" TIMESTAMP(3);
ALTER TABLE "MobileAccount" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
