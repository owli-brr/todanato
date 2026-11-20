/* End-to-end API checks against a running server with seeded data.
 * Run: npm run db:seed && npm run dev   (in another terminal)  then  npm test */
import assert from 'node:assert/strict';
import { test } from 'node:test';

const BASE = process.env.API_URL ?? 'http://localhost:4000/api';
const PW = 'Toda2026demo';

async function call(token: string | null, method: string, path: string, body?: unknown) {
  const isForm = body instanceof FormData;
  const r = await fetch(BASE + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? (isForm ? (body as FormData) : JSON.stringify(body)) : undefined,
  });
  const text = await r.text();
  let json: any; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
}
const tokens: Record<string, string> = {};
async function login(email: string) {
  if (tokens[email]) return tokens[email];
  const r = await call(null, 'POST', '/auth/login', { email, password: PW });
  assert.equal(r.status, 200, `login ${email}: ${JSON.stringify(r.body)}`);
  return (tokens[email] = r.body.accessToken);
}

test('rejects bad credentials and unauthenticated requests', async () => {
  assert.equal((await call(null, 'POST', '/auth/login', { email: 'superadmin@toms.ph', password: 'wrong-password1' })).status, 401);
  assert.equal((await call(null, 'GET', '/drivers')).status, 401);
  assert.equal((await call('not-a-token', 'GET', '/drivers')).status, 401);
});

test('association officers only see their own association', async () => {
  const sa = await login('superadmin@toms.ph');
  const pres = await login('president.srtoda@toms.ph');
  const all = await call(sa, 'GET', '/drivers?pageSize=100');
  const mine = await call(pres, 'GET', '/drivers?pageSize=100');
  assert.ok(all.body.total > mine.body.total);
  const myAssoc = mine.body.items[0].association.id;
  assert.ok(mine.body.items.every((d: any) => d.association.id === myAssoc));
  const other = all.body.items.find((d: any) => d.association?.id !== myAssoc);
  assert.equal((await call(pres, 'GET', `/drivers/${other.id}`)).status, 404, 'other association driver is hidden');
  assert.equal((await call(pres, 'PATCH', `/drivers/${other.id}`, { contactNumber: '09171112222' })).status, 404);
  const assocs = await call(pres, 'GET', '/associations?all=true');
  assert.equal(assocs.body.length, 1);
  // Filtering by another association id must not leak.
  const leak = await call(pres, 'GET', `/drivers?associationId=${other.association.id}`);
  assert.equal(leak.body.total, 0);
});

test('role permissions are enforced', async () => {
  const tr = await login('treasurer.srtoda@toms.ph');
  const disp = await login('dispatcher.srtoda@toms.ph');
  const aud = await login('auditor@toms.ph');
  assert.equal((await call(tr, 'POST', '/drivers', {})).status, 403);
  assert.equal((await call(disp, 'GET', '/users')).status, 403);
  assert.equal((await call(aud, 'GET', '/audit-logs')).status, 200);
  const d = (await call(aud, 'GET', '/drivers?pageSize=1')).body.items[0];
  assert.equal((await call(aud, 'POST', `/drivers/${d.id}/status`, { status: 'INACTIVE' })).status, 403);
  // Dispatcher lacks drivers.pii → personal details are masked.
  const dd = (await call(disp, 'GET', '/drivers?pageSize=1')).body.items[0];
  assert.equal(dd.address, '••••••');
  assert.equal(dd.dateOfBirth, null);
  // Dashboard hides money from roles without finance.read.
  assert.equal((await call(disp, 'GET', '/dashboard/summary')).body.finance, null);
  assert.ok((await call(tr, 'GET', '/dashboard/summary')).body.finance);
});

test('driver lifecycle: register → approve → assign tricycle → suspend', async () => {
  const sec = await login('secretary.srtoda@toms.ph');
  const pres = await login('president.srtoda@toms.ph');
  const lic = `T${String(Date.now()).slice(-2)}-25-${String(Date.now()).slice(-6)}`;
  const created = await call(sec, 'POST', '/drivers', {
    firstName: 'Test', lastName: 'Driver', dateOfBirth: '1990-05-01', contactNumber: '09171234567', address: '1 Rizal St., Brgy. San Roque',
    emergencyName: 'Maria Driver', emergencyPhone: '09181234567', licenseNumber: lic, licenseExpiry: '2029-01-01',
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id;
  assert.equal(created.body.status, 'PENDING');
  // Validation
  const bad = await call(sec, 'POST', '/drivers', { firstName: '', contactNumber: '123', licenseNumber: 'x' });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.fields.contactNumber && bad.body.fields.licenseNumber);
  // Duplicate license
  assert.equal((await call(sec, 'POST', '/drivers', { ...created.body, dateOfBirth: '1990-05-01', licenseExpiry: '2029-01-01', email: null })).status, 409);
  // Secretary cannot approve; president can.
  assert.equal((await call(sec, 'POST', `/drivers/${id}/application`, { decision: 'APPROVE' })).status, 403);
  assert.equal((await call(pres, 'POST', `/drivers/${id}/application`, { decision: 'APPROVE' })).status, 200);
  const prof = await call(pres, 'GET', `/drivers/${id}`);
  assert.equal(prof.body.status, 'ACTIVE');
  assert.equal(prof.body.memberships[0].status, 'ACTIVE');
  // Upload a document (PDF magic bytes checked)
  const fd = new FormData();
  fd.append('type', 'BARANGAY_CLEARANCE');
  fd.append('file', new Blob(['%PDF-1.4\n%test\n'], { type: 'application/pdf' }), 'clearance.pdf');
  const up = await call(sec, 'POST', `/drivers/${id}/documents`, fd);
  assert.equal(up.status, 201, JSON.stringify(up.body));
  const fake = new FormData();
  fake.append('type', 'OTHER');
  fake.append('file', new Blob(['MZ not a pdf'], { type: 'application/pdf' }), 'evil.pdf');
  assert.equal((await call(sec, 'POST', `/drivers/${id}/documents`, fake)).status, 400);
  assert.equal((await call(pres, 'POST', `/drivers/${id}/documents/${up.body.id}/verify`, { status: 'VERIFIED' })).status, 200);
  // Register a tricycle and assign
  const plate = `ZZ ${String(Date.now()).slice(-5)}`;
  const v = await call(sec, 'POST', '/vehicles', { plateNumber: plate, ownerName: 'Test Owner', make: 'Honda', model: 'TMX 155', color: 'Blue', driverId: id });
  assert.equal(v.status, 201, JSON.stringify(v.body));
  const vp = await call(sec, 'GET', `/vehicles/${v.body.id}`);
  assert.equal(vp.body.currentDriver.id, id);
  // Suspension requires a reason
  assert.equal((await call(pres, 'POST', `/drivers/${id}/status`, { status: 'SUSPENDED' })).status, 400);
  assert.equal((await call(pres, 'POST', `/drivers/${id}/status`, { status: 'SUSPENDED', reason: 'Test suspension' })).status, 200);
  // Suspended drivers cannot be assigned
  assert.equal((await call(sec, 'POST', `/vehicles/${v.body.id}/assign`, { driverId: id })).status, 409);
  // Everything is in the audit log
  const logs = await call(pres, 'GET', `/audit-logs?q=${encodeURIComponent('Test Driver')}&pageSize=50`);
  const actions = logs.body.items.map((l: any) => l.action);
  for (const a of ['CREATE', 'APPROVE', 'UPLOAD', 'VERIFY', 'SUSPEND']) assert.ok(actions.includes(a), `audit has ${a}`);
  // Clean up
  const sa = await login('superadmin@toms.ph');
  assert.equal((await call(sa, 'DELETE', `/vehicles/${v.body.id}`)).status, 200);
  assert.equal((await call(sa, 'DELETE', `/drivers/${id}`)).status, 200);
});

test('users: cannot escalate privileges', async () => {
  const pres = await login('president.srtoda@toms.ph');
  const sa = await login('superadmin@toms.ph');
  const roles = (await call(pres, 'GET', '/roles')).body;
  const superRole = roles.find((r: any) => r.key === 'SUPER_ADMIN');
  const orgAdmin = roles.find((r: any) => r.key === 'ORG_ADMIN');
  const secRole = roles.find((r: any) => r.key === 'SECRETARY');
  // President has no users.manage by default
  assert.equal((await call(pres, 'POST', '/users', { fullName: 'X', email: 'x@toms.ph', roleId: superRole.id })).status, 403);
  // Org admin cannot create a super admin
  const admin = await login('admin@toms.ph');
  assert.equal((await call(admin, 'POST', '/users', { fullName: 'Sneaky', email: `sneaky${Date.now()}@toms.ph`, roleId: superRole.id })).status, 403);
  assert.equal((await call(admin, 'POST', '/users', { fullName: 'Sneaky', email: `sneaky${Date.now()}@toms.ph`, roleId: orgAdmin.id })).status, 403);
  // Org admin can create a secretary, who must change password on first login
  const assoc = (await call(admin, 'GET', '/associations?all=true')).body[1];
  const email = `newsec${Date.now()}@toms.ph`;
  const u = await call(admin, 'POST', '/users', { fullName: 'New Secretary', email, roleId: secRole.id, associationId: assoc.id });
  assert.equal(u.status, 201, JSON.stringify(u.body));
  const li = await call(null, 'POST', '/auth/login', { email, password: u.body.temporaryPassword });
  assert.equal(li.status, 200);
  assert.equal(li.body.user.mustChangePassword, true);
  // Deactivation ends access immediately
  assert.equal((await call(admin, 'POST', `/users/${u.body.user.id}/status`, { active: false })).status, 200);
  assert.equal((await call(li.body.accessToken, 'GET', '/auth/me')).status, 401);
  // Only Super Admin can edit role permissions
  assert.equal((await call(admin, 'PUT', `/roles/${secRole.id}/permissions`, { permissions: [] })).status, 403);
  assert.equal((await call(sa, 'PUT', `/roles/${superRole.id}/permissions`, { permissions: [] })).status, 403);
});

test('dashboard endpoints respond for every period', async () => {
  const sa = await login('superadmin@toms.ph');
  for (const p of ['daily', 'weekly', 'monthly']) {
    const r = await call(sa, 'GET', `/dashboard/activity?period=${p}`);
    assert.equal(r.status, 200);
    assert.ok(r.body.length >= 12);
  }
  const f = await call(sa, 'GET', '/dashboard/feed');
  assert.equal(f.status, 200);
  assert.ok(Array.isArray(f.body.expiring));
});

test('public driver application: apply → officer sees it → approve → status check', async () => {
  const assocs = (await call(null, 'GET', '/public/associations')).body;
  const sr = assocs.find((a: any) => a.name.includes('San Roque'));
  assert.ok(sr, 'San Roque TODA is listed publicly');
  const lic = `P${String(Date.now()).slice(-2)}-26-${String(Date.now()).slice(-6)}`;
  const fd = new FormData();
  const fields: Record<string, string> = {
    associationId: sr.id, firstName: 'Ramon', lastName: 'Online', dateOfBirth: '1990-05-01', contactNumber: '09171112222',
    address: '12 Sumulong Hwy', emergencyName: 'Liza Online', emergencyPhone: '09173334444', licenseNumber: lic, licenseExpiry: '2030-01-01', consent: 'true',
  };
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append('license', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), 'license.pdf');

  // Missing consent and honeypot are rejected
  const noConsent = new FormData();
  for (const [k, v] of Object.entries(fields)) if (k !== 'consent') noConsent.append(k, v);
  assert.equal((await call(null, 'POST', '/public/driver-applications', noConsent)).status, 400);

  const r = await call(null, 'POST', '/public/driver-applications', fd);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const ref = r.body.reference;
  assert.equal((await call(null, 'POST', '/public/driver-applications', fd)).status, 409, 'duplicate license');

  const pending = await call(null, 'POST', '/public/driver-applications/status', { reference: ref, licenseNumber: lic });
  assert.equal(pending.body.status, 'PENDING');
  assert.equal((await call(null, 'POST', '/public/driver-applications/status', { reference: ref, licenseNumber: 'A00-00-000000' })).status, 404);

  // The other association can't see it; San Roque's president can approve it
  const mj = await login('president.mjtoda@toms.ph');
  assert.equal((await call(mj, 'GET', `/drivers?q=${lic}`)).body.items.length, 0);
  const pres = await login('president.srtoda@toms.ph');
  const found = (await call(pres, 'GET', `/drivers?q=${lic}&application=PENDING`)).body.items;
  assert.equal(found.length, 1);
  const profile = (await call(pres, 'GET', `/drivers/${found[0].id}`)).body;
  assert.equal(profile.documents.length, 1);
  assert.equal((await call(pres, 'POST', `/drivers/${found[0].id}/application`, { decision: 'APPROVE' })).status, 200);
  assert.equal((await call(null, 'POST', '/public/driver-applications/status', { reference: ref, licenseNumber: lic })).body.status, 'APPROVED');
});
