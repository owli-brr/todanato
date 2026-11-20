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
  assert.equal((await call(null, 'POST', '/auth/login', { email: 'superadmin@todanato.ph', password: 'wrong-password1' })).status, 401);
  assert.equal((await call(null, 'GET', '/drivers')).status, 401);
  assert.equal((await call('not-a-token', 'GET', '/drivers')).status, 401);
});

test('one TODA: everything belongs to it and associations cannot be added', async () => {
  const sa = await login('superadmin@todanato.ph');
  const pres = await login('president@todanato.ph');
  const assocs = (await call(sa, 'GET', '/associations?all=true')).body;
  assert.equal(assocs.length, 1, 'exactly one TODA');
  const all = await call(sa, 'GET', '/drivers?pageSize=100');
  const mine = await call(pres, 'GET', '/drivers?pageSize=100');
  assert.equal(all.body.total, mine.body.total, 'officers see the whole TODA');
  assert.ok(mine.body.items.every((d: any) => d.association.id === assocs[0].id));
  assert.equal((await call(sa, 'POST', '/associations', { name: 'Another TODA' })).status, 404, 'no endpoint to add a TODA');
  assert.equal((await call(sa, 'DELETE', `/associations/${assocs[0].id}`)).status, 404, 'no endpoint to archive the TODA');
  const roles = (await call(sa, 'GET', '/roles')).body.map((r: any) => r.key);
  assert.ok(!roles.includes('ORG_ADMIN'), 'no organization admin role');
});

test('role permissions are enforced', async () => {
  const tr = await login('treasurer@todanato.ph');
  const disp = await login('dispatcher@todanato.ph');
  const aud = await login('auditor@todanato.ph');
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
  const sec = await login('secretary@todanato.ph');
  const pres = await login('president@todanato.ph');
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
  const sa = await login('superadmin@todanato.ph');
  assert.equal((await call(sa, 'DELETE', `/vehicles/${v.body.id}`)).status, 200);
  assert.equal((await call(sa, 'DELETE', `/drivers/${id}`)).status, 200);
});

test('users: cannot escalate privileges', async () => {
  const pres = await login('president@todanato.ph');
  const sec = await login('secretary@todanato.ph');
  const sa = await login('superadmin@todanato.ph');
  const roles = (await call(pres, 'GET', '/roles')).body;
  const superRole = roles.find((r: any) => r.key === 'SUPER_ADMIN');
  const presRole = roles.find((r: any) => r.key === 'ASSOC_PRESIDENT');
  const secRole = roles.find((r: any) => r.key === 'SECRETARY');
  // Secretary cannot manage users; president cannot create a super admin or another president
  assert.equal((await call(sec, 'POST', '/users', { fullName: 'X', email: 'x@example.ph', roleId: secRole.id })).status, 403);
  assert.equal((await call(pres, 'POST', '/users', { fullName: 'Sneaky', email: `sneaky${Date.now()}@example.ph`, roleId: superRole.id })).status, 403);
  assert.equal((await call(pres, 'POST', '/users', { fullName: 'Sneaky', email: `sneaky${Date.now()}@example.ph`, roleId: presRole.id })).status, 403);
  // President can add a secretary (joined to the TODA automatically), who must change password on first login
  const email = `newsec${Date.now()}@example.ph`;
  const u = await call(pres, 'POST', '/users', { fullName: 'New Secretary', email, roleId: secRole.id });
  assert.equal(u.status, 201, JSON.stringify(u.body));
  assert.ok(u.body.user.association?.id, 'assigned to the TODA');
  const li = await call(null, 'POST', '/auth/login', { email, password: u.body.temporaryPassword });
  assert.equal(li.status, 200);
  assert.equal(li.body.user.mustChangePassword, true);
  // Deactivation ends access immediately
  assert.equal((await call(pres, 'POST', `/users/${u.body.user.id}/status`, { active: false })).status, 200);
  assert.equal((await call(li.body.accessToken, 'GET', '/auth/me')).status, 401);
  // Only Super Admin can edit role permissions
  assert.equal((await call(pres, 'PUT', `/roles/${secRole.id}/permissions`, { permissions: [] })).status, 403);
  assert.equal((await call(sa, 'PUT', `/roles/${superRole.id}/permissions`, { permissions: [] })).status, 403);
});

test('dashboard endpoints respond for every period', async () => {
  const sa = await login('superadmin@todanato.ph');
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
  const toda = (await call(null, 'GET', '/public/toda')).body;
  assert.ok(toda.name, 'TODA name is public');
  const lic = `P${String(Date.now()).slice(-2)}-26-${String(Date.now()).slice(-6)}`;
  const fd = new FormData();
  const fields: Record<string, string> = {
    firstName: 'Ramon', lastName: 'Online', dateOfBirth: '1990-05-01', contactNumber: '09171112222',
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

  // The president sees it as a pending application and approves it
  const pres = await login('president@todanato.ph');
  const found = (await call(pres, 'GET', `/drivers?q=${lic}&application=PENDING`)).body.items;
  assert.equal(found.length, 1);
  const profile = (await call(pres, 'GET', `/drivers/${found[0].id}`)).body;
  assert.equal(profile.documents.length, 1);
  assert.equal((await call(pres, 'POST', `/drivers/${found[0].id}/application`, { decision: 'APPROVE' })).status, 200);
  assert.equal((await call(null, 'POST', '/public/driver-applications/status', { reference: ref, licenseNumber: lic })).body.status, 'APPROVED');
});
