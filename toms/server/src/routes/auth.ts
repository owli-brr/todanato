import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ah, HttpError } from '../lib/http';
import { audit } from '../lib/audit';
import { authenticate, signAccessToken, ACCESS_TTL_SECONDS } from '../middleware/auth';

export const authRouter = Router();

const REFRESH_COOKIE = 'toms_rt';
const SESSION_DAYS = 7;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export const passwordSchema = z
  .string()
  .min(10, 'At least 10 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Include a letter')
  .regex(/\d/, 'Include a number');

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many sign-in attempts. Try again in a few minutes.' } });

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/auth',
    maxAge: SESSION_DAYS * 86400 * 1000,
  });
}

async function userPayload(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
      association: { select: { id: true, name: true, code: true } },
      organization: { select: { id: true, name: true } },
    },
  });
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    phone: u.phone,
    mustChangePassword: u.mustChangePassword,
    role: { key: u.role.key, name: u.role.name, scope: u.role.scope },
    permissions: u.role.permissions.map((p) => p.permission.key).sort(),
    association: u.association,
    organization: u.organization,
  };
}

async function startSession(req: Request, res: Response, userId: string) {
  const refresh = crypto.randomBytes(48).toString('base64url');
  const session = await prisma.session.create({
    data: {
      userId,
      refreshHash: sha256(refresh),
      userAgent: req.get('user-agent')?.slice(0, 300),
      ipAddress: req.ip,
      expiresAt: new Date(Date.now() + SESSION_DAYS * 86400 * 1000),
    },
  });
  setRefreshCookie(res, refresh);
  return { accessToken: signAccessToken(userId, session.id), expiresIn: ACCESS_TTL_SECONDS };
}

authRouter.post(
  '/login',
  loginLimiter,
  ah(async (req, res) => {
    const { email, password } = z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email'), password: z.string().min(1, 'Enter your password') }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    const log = (success: boolean, reason?: string) =>
      prisma.loginHistory.create({ data: { userId: user?.id, email, success, reason, ipAddress: req.ip, userAgent: req.get('user-agent')?.slice(0, 300) } });

    if (!user || user.deletedAt) {
      await bcrypt.compare(password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv'); // equalise timing
      await log(false, 'Unknown email');
      throw new HttpError(401, 'Incorrect email or password');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await log(false, 'Locked');
      throw new HttpError(423, `Too many failed attempts. Try again after ${user.lockedUntil.toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila' })}.`);
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      const failed = user.failedLogins + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: failed >= MAX_FAILED ? 0 : failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60000) : null },
      });
      await log(false, 'Wrong password');
      throw new HttpError(401, 'Incorrect email or password');
    }
    if (!user.isActive) {
      await log(false, 'Deactivated');
      throw new HttpError(403, 'Your account is deactivated. Contact your administrator.');
    }
    await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    await log(true);
    await audit(req, { action: 'LOGIN', entity: 'User', entityId: user.id, summary: `${user.email} signed in`, userId: user.id, userEmail: user.email });
    const tokens = await startSession(req, res, user.id);
    res.json({ ...tokens, user: await userPayload(user.id) });
  }),
);

authRouter.post(
  '/refresh',
  ah(async (req, res) => {
    const token: string | undefined = req.cookies?.[REFRESH_COOKIE] ?? req.body?.refreshToken;
    if (!token) throw new HttpError(401, 'Please sign in');
    const session = await prisma.session.findUnique({ where: { refreshHash: sha256(token) }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt < new Date() || !session.user.isActive || session.user.deletedAt) {
      res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
      throw new HttpError(401, 'Your session has ended. Please sign in again.');
    }
    // Rotate the refresh token on every use.
    const next = crypto.randomBytes(48).toString('base64url');
    await prisma.session.update({ where: { id: session.id }, data: { refreshHash: sha256(next), lastUsedAt: new Date() } });
    setRefreshCookie(res, next);
    res.json({ accessToken: signAccessToken(session.userId, session.id), expiresIn: ACCESS_TTL_SECONDS, user: await userPayload(session.userId) });
  }),
);

authRouter.post(
  '/logout',
  ah(async (req, res) => {
    const token: string | undefined = req.cookies?.[REFRESH_COOKIE];
    if (token) await prisma.session.updateMany({ where: { refreshHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    res.json({ ok: true });
  }),
);

const forgotLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, message: { error: 'Too many reset requests. Try again later.' } });

authRouter.post(
  '/forgot-password',
  forgotLimiter,
  ah(async (req, res) => {
    const { email } = z.object({ email: z.string().trim().toLowerCase().email() }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    let devToken: string | undefined;
    if (user && user.isActive && !user.deletedAt) {
      const token = crypto.randomBytes(32).toString('base64url');
      await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 30 * 60000) } });
      // TODO(Phase 2): send through the email/SMS provider configured in Settings.
      if (process.env.NODE_ENV !== 'production') {
        devToken = token;
        console.log(`[dev] Password reset link for ${email}: ${process.env.WEB_ORIGIN}/reset-password?token=${token}`);
      }
    }
    // Same response whether or not the email exists, so accounts can't be enumerated.
    res.json({ ok: true, message: 'If that email has an account, a reset link has been sent.', devToken });
  }),
);

authRouter.post(
  '/reset-password',
  ah(async (req, res) => {
    const { token, password } = z.object({ token: z.string().min(10), password: passwordSchema }).parse(req.body);
    const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.usedAt || row.expiresAt < new Date()) throw new HttpError(400, 'This reset link is invalid or has expired');
    await prisma.$transaction([
      prisma.user.update({ where: { id: row.userId }, data: { passwordHash: await bcrypt.hash(password, 12), mustChangePassword: false, failedLogins: 0, lockedUntil: null } }),
      prisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      prisma.session.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await audit(req, { action: 'PASSWORD_RESET', entity: 'User', entityId: row.userId, summary: 'Password reset by email link', userId: row.userId });
    res.json({ ok: true });
  }),
);

// ───── Authenticated ─────

authRouter.get('/me', authenticate, ah(async (req, res) => res.json(await userPayload(req.auth!.userId))));

authRouter.post(
  '/change-password',
  authenticate,
  ah(async (req, res) => {
    const { currentPassword, newPassword } = z
      .object({ currentPassword: z.string().min(1, 'Enter your current password'), newPassword: passwordSchema })
      .parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new HttpError(400, 'Current password is incorrect', undefined);
    }
    if (currentPassword === newPassword) throw new HttpError(400, 'Choose a password different from the current one');
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(newPassword, 12), mustChangePassword: false } }),
      // Sign out every other session.
      prisma.session.updateMany({ where: { userId: user.id, revokedAt: null, id: { not: req.auth!.sessionId } }, data: { revokedAt: new Date() } }),
    ]);
    await audit(req, { action: 'PASSWORD_CHANGE', entity: 'User', entityId: user.id, summary: 'Changed own password' });
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/sessions',
  authenticate,
  ah(async (req, res) => {
    const sessions = await prisma.session.findMany({
      where: { userId: req.auth!.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      select: { id: true, userAgent: true, ipAddress: true, client: true, createdAt: true, lastUsedAt: true, expiresAt: true },
    });
    res.json(sessions.map((s) => ({ ...s, current: s.id === req.auth!.sessionId })));
  }),
);

authRouter.delete(
  '/sessions/:id',
  authenticate,
  ah(async (req, res) => {
    await prisma.session.updateMany({ where: { id: req.params.id, userId: req.auth!.userId }, data: { revokedAt: new Date() } });
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/login-history',
  authenticate,
  ah(async (req, res) => {
    res.json(
      await prisma.loginHistory.findMany({ where: { userId: req.auth!.userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    );
  }),
);
