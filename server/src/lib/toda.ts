import { prisma } from './prisma';
import { HttpError } from './http';

// TODAnaTo runs one TODA. The schema keeps an Association table (so data stays
// scoped and later phases still fit), but there is exactly one row in use.
let cached: string | null = null;

export async function todaId(): Promise<string> {
  if (cached) return cached;
  const a = await prisma.association.findFirst({ where: { deletedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!a) throw new HttpError(503, 'The TODA profile has not been set up yet');
  return (cached = a.id);
}

export async function theToda() {
  return prisma.association.findUniqueOrThrow({ where: { id: await todaId() } });
}
