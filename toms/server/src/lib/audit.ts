import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

const SENSITIVE = new Set(['passwordHash', 'refreshHash', 'tokenHash']);

function clean(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  return JSON.parse(
    JSON.stringify(v, (k, val) => (SENSITIVE.has(k) ? undefined : val)),
  ) as Prisma.InputJsonValue;
}

/** Only keep fields that actually changed so the audit trail stays readable. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of Object.keys(after)) {
    if (SENSITIVE.has(k) || k === 'updatedAt') continue;
    const bv = JSON.stringify(before[k] ?? null);
    const av = JSON.stringify(after[k] ?? null);
    if (bv !== av) {
      b[k] = before[k] ?? null;
      a[k] = after[k] ?? null;
    }
  }
  return { before: b, after: a, changed: Object.keys(a) };
}

export async function audit(
  req: Request | null,
  entry: {
    action: string;
    entity: string;
    entityId?: string | null;
    summary: string;
    before?: unknown;
    after?: unknown;
    associationId?: string | null;
    userId?: string | null;
    userEmail?: string | null;
  },
) {
  await prisma.auditLog.create({
    data: {
      userId: entry.userId ?? req?.auth?.userId ?? null,
      userEmail: entry.userEmail ?? req?.auth?.email ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      summary: entry.summary,
      before: clean(entry.before),
      after: clean(entry.after),
      ipAddress: req?.ip ?? null,
      associationId: entry.associationId ?? null,
    },
  });
}
