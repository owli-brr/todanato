import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { HttpError, forbidden } from '../lib/http';
import type { PermissionKey } from '../lib/permissions';

export const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret';
export const ACCESS_TTL_SECONDS = 15 * 60;

export interface AuthContext {
  userId: string;
  sessionId: string;
  email: string;
  fullName: string;
  roleKey: string;
  roleName: string;
  scope: 'GLOBAL' | 'ORGANIZATION' | 'ASSOCIATION';
  permissions: Set<string>;
  organizationId: string | null;
  associationId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

interface AccessPayload {
  sub: string;
  sid: string;
  typ: 'access';
  aud: 'admin';
}

export function signAccessToken(userId: string, sessionId: string) {
  const payload: AccessPayload = { sub: userId, sid: sessionId, typ: 'access', aud: 'admin' };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TTL_SECONDS });
}

/** Loads the user, role and permissions fresh on each request so deactivation and
 *  permission edits take effect immediately. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'Please sign in');
    let payload: AccessPayload;
    try {
      payload = jwt.verify(header.slice(7), JWT_SECRET, { audience: 'admin' }) as AccessPayload;
    } catch {
      throw new HttpError(401, 'Your session has expired. Please sign in again.');
    }
    if (payload.typ !== 'access') throw new HttpError(401, 'Invalid token');

    const [user, session] = await Promise.all([
      prisma.user.findUnique({
        where: { id: payload.sub },
        include: { role: { include: { permissions: { include: { permission: true } } } } },
      }),
      prisma.session.findUnique({ where: { id: payload.sid } }),
    ]);
    if (!user || user.deletedAt || !user.isActive) throw new HttpError(401, 'Your account is not active');
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new HttpError(401, 'Your session has ended. Please sign in again.');
    }

    req.auth = {
      userId: user.id,
      sessionId: session.id,
      email: user.email,
      fullName: user.fullName,
      roleKey: user.role.key,
      roleName: user.role.name,
      scope: user.role.scope,
      permissions: new Set(user.role.permissions.map((rp) => rp.permission.key)),
      organizationId: user.organizationId,
      associationId: user.associationId,
    };
    next();
  } catch (e) {
    next(e);
  }
}

export const can = (req: Request, perm: PermissionKey) => !!req.auth?.permissions.has(perm);

export const requirePermission =
  (...perms: PermissionKey[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(new HttpError(401, 'Please sign in'));
    if (!perms.every((p) => req.auth!.permissions.has(p))) return next(forbidden());
    next();
  };

// ─────────── Data isolation ───────────
// Every query on association-owned data goes through these helpers.

/** Prisma `where` fragment for models that have an `associationId` column. */
export function assocScope(req: Request): { associationId?: string | { in: string[] } } & Record<string, unknown> {
  const a = req.auth!;
  if (a.scope === 'GLOBAL') return {};
  if (a.scope === 'ORGANIZATION') {
    return { OR: [{ association: { organizationId: a.organizationId ?? '__none__' } }, { associationId: null }] };
  }
  return { associationId: a.associationId ?? '__none__' };
}

/** Prisma `where` fragment for the Association model itself. */
export function associationScope(req: Request): Record<string, unknown> {
  const a = req.auth!;
  if (a.scope === 'GLOBAL') return {};
  if (a.scope === 'ORGANIZATION') return { organizationId: a.organizationId ?? '__none__' };
  return { id: a.associationId ?? '__none__' };
}

/** Throws 403 unless the user may act on the given association. */
export async function assertAssociationAccess(req: Request, associationId: string | null | undefined) {
  const a = req.auth!;
  if (a.scope === 'GLOBAL') return;
  if (!associationId) {
    if (a.scope === 'ORGANIZATION') return;
    throw forbidden('You can only manage records of your own association');
  }
  if (a.scope === 'ASSOCIATION') {
    if (associationId !== a.associationId) throw forbidden('You can only manage records of your own association');
    return;
  }
  const assoc = await prisma.association.findUnique({ where: { id: associationId }, select: { organizationId: true } });
  if (!assoc || assoc.organizationId !== a.organizationId) throw forbidden('This association is outside your organization');
}
