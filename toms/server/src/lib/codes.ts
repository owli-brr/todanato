import { prisma } from './prisma';

/** Next sequential human-readable code, e.g. DRV-2026-00042. */
export async function nextDriverCode() {
  const year = new Date().getFullYear();
  const prefix = `DRV-${year}-`;
  const last = await prisma.driver.findFirst({
    where: { driverCode: { startsWith: prefix } },
    orderBy: { driverCode: 'desc' },
    select: { driverCode: true },
  });
  const n = last ? parseInt(last.driverCode.slice(prefix.length), 10) + 1 : 1;
  return prefix + String(n).padStart(5, '0');
}

export async function nextVehicleCode() {
  const last = await prisma.vehicle.findFirst({ orderBy: { vehicleCode: 'desc' }, select: { vehicleCode: true } });
  const n = last ? parseInt(last.vehicleCode.slice(4), 10) + 1 : 1;
  return 'TRC-' + String(n).padStart(5, '0');
}

export async function nextMembershipNo(associationCode: string) {
  const prefix = `${associationCode}-M`;
  const last = await prisma.associationMembership.findFirst({
    where: { membershipNo: { startsWith: prefix } },
    orderBy: { membershipNo: 'desc' },
    select: { membershipNo: true },
  });
  const n = last ? parseInt(last.membershipNo.slice(prefix.length), 10) + 1 : 1;
  return prefix + String(n).padStart(4, '0');
}

export async function nextAssociationCode() {
  const last = await prisma.association.findFirst({ orderBy: { code: 'desc' }, select: { code: true } });
  const n = last ? parseInt(last.code.slice(5), 10) + 1 : 1;
  return 'TODA-' + String(n).padStart(3, '0');
}
