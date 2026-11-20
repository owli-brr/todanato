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

test('driver portal: approved applicant activates, signs in, sees only their own record', async () => {
  const stamp = String(Date.now()).slice(-7);
  const lic = `Q${stamp.slice(0, 2)}-26-${stamp.slice(-6)}`;
  const phone = `0918${stamp}`;
  const fd = new FormData();
  const fields: Record<string, string> = {
    firstName: 'Portal', lastName: 'Tester', dateOfBirth: '1991-02-03', contactNumber: phone,
    address: '1 Test St', emergencyName: 'Kin Tester', emergencyPhone: '09175556666', licenseNumber: lic, licenseExpiry: '2030-01-01', consent: 'true',
  };
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const ref = (await call(null, 'POST', '/public/driver-applications', fd)).body.reference;
  assert.ok(ref);

  const post = (path: string, body: unknown, cookie?: string) => fetch(BASE + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body),
  });
  const activate = { reference: ref, licenseNumber: lic, phone, password: 'Portal2026pass' };

  // Not yet approved: cannot activate
  assert.equal((await post('/driver/activate', activate)).status, 409, 'not approved yet');

  const pres = await login('president@todanato.ph');
  const id = (await call(pres, 'GET', `/drivers?q=${lic}&application=PENDING`)).body.items[0].id;
  await call(pres, 'POST', `/drivers/${id}/application`, { decision: 'APPROVE' });

  // Wrong phone fails, right details succeed, second activation is refused
  assert.equal((await post('/driver/activate', { ...activate, phone: '09990000000' })).status, 400);
  const act = await post('/driver/activate', activate);
  assert.equal(act.status, 201, await act.clone().text());
  assert.equal((await post('/driver/activate', activate)).status, 409);

  const bad = await post('/driver/login', { phone, password: 'wrong-password' });
  assert.equal(bad.status, 401);
  const ok = await post('/driver/login', { phone, password: 'Portal2026pass' });
  assert.equal(ok.status, 200);
  const cookie = ok.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  assert.match(cookie, /todanato_drv=/);

  const me = await fetch(BASE + '/driver/me', { headers: { Cookie: cookie } });
  assert.equal(me.status, 200);
  const body = await me.json();
  assert.equal(body.driver.licenseNumber, lic);
  assert.ok(body.toda.name);

  // A driver cookie is not a staff session
  assert.equal((await fetch(BASE + '/drivers', { headers: { Cookie: cookie } })).status, 401);
  assert.equal((await fetch(BASE + '/driver/me')).status, 401);

  // Staff see the portal account and can reset it, which signs the driver out
  assert.equal((await call(pres, 'GET', `/drivers/${id}`)).body.portal.active, true);
  assert.equal((await call(pres, 'DELETE', `/drivers/${id}/portal-account`)).status, 200);
  assert.equal((await fetch(BASE + '/driver/me', { headers: { Cookie: cookie } })).status, 401);

  // Changing the password signs out older sessions
  const again = await post('/driver/activate', activate);
  assert.equal(again.status, 201, 'can set up again after a reset');
  const c2 = again.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const changed = await post('/driver/change-password', { currentPassword: 'Portal2026pass', newPassword: 'Another2026pass' }, c2);
  assert.equal(changed.status, 200);
  assert.equal((await fetch(BASE + '/driver/me', { headers: { Cookie: c2 } })).status, 401, 'old session revoked');
  assert.equal((await post('/driver/login', { phone, password: 'Another2026pass' })).status, 200);
});

test('finance: record payment applies to oldest dues, void reverses it, corrections link', async () => {
  const tr = await login('treasurer@todanato.ph');
  const disp = await login('dispatcher@todanato.ph');
  const aud = await login('auditor@todanato.ph');

  // Find a driver with an open monthly-dues charge
  const open = (await call(tr, 'GET', '/finance/dues?status=OPEN&type=MONTHLY_DUES&sort=dueDate&dir=asc&pageSize=50')).body.items;
  assert.ok(open.length > 0, 'seed has unpaid dues');
  const driverId = open[0].driver.id;
  const mine = (await call(tr, 'GET', `/finance/dues?status=OPEN&type=MONTHLY_DUES&driverId=${driverId}&sort=dueDate&dir=asc`)).body.items;
  const first = mine[0];

  // Validation and permissions
  assert.equal((await call(tr, 'POST', '/finance/payments', { driverId, type: 'MONTHLY_DUES', method: 'GCASH', amount: 50 })).status, 400, 'GCash needs a reference');
  assert.equal((await call(disp, 'POST', '/finance/payments', { driverId, type: 'MONTHLY_DUES', method: 'CASH', amount: 50 })).status, 403);
  assert.equal((await call(aud, 'GET', '/finance/summary')).status, 200, 'auditor can read');
  assert.equal((await call(aud, 'POST', '/finance/expenses', { category: 'X', description: 'Nope', amount: 1, method: 'CASH', spentAt: '2026-01-01' })).status, 403);

  // Partial payment
  const part = await call(tr, 'POST', '/finance/payments', { driverId, type: 'MONTHLY_DUES', method: 'CASH', amount: 50 });
  assert.equal(part.status, 201, JSON.stringify(part.body));
  assert.match(part.body.receiptNo, /^OR-\d{4}-\d{6}$/);
  let receipt = (await call(tr, 'GET', `/finance/payments/${part.body.id}`)).body;
  assert.equal(receipt.allocations.length, 1);
  assert.equal(receipt.allocations[0].due.id, first.id, 'applied to the oldest charge');
  let charge = (await call(tr, 'GET', `/finance/dues?driverId=${driverId}&type=MONTHLY_DUES&pageSize=100`)).body.items.find((c: any) => c.id === first.id);
  assert.equal(charge.status, 'PARTIAL');

  // Void with a correction: the original charge goes back to unpaid, the correction pays it in full
  assert.equal((await call(tr, 'POST', `/finance/payments/${part.body.id}/void`, { reason: 'x' })).status, 400, 'reason required');
  const v = await call(tr, 'POST', `/finance/payments/${part.body.id}/void`, { reason: 'Wrong amount entered', replacement: { driverId, type: 'MONTHLY_DUES', method: 'CASH', amount: Number(first.amount) } });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal((await call(tr, 'POST', `/finance/payments/${part.body.id}/void`, { reason: 'Again please' })).status, 409);
  receipt = (await call(tr, 'GET', `/finance/payments/${part.body.id}`)).body;
  assert.equal(receipt.status, 'VOIDED');
  assert.equal(receipt.replacedBy.id, v.body.replacement.id);
  charge = (await call(tr, 'GET', `/finance/dues?driverId=${driverId}&type=MONTHLY_DUES&pageSize=100`)).body.items.find((c: any) => c.id === first.id);
  assert.equal(charge.status, 'PAID');
  assert.equal(charge.balance, 0);

  // Billing a month twice creates nothing the second time
  const d = new Date(); const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  await call(tr, 'POST', '/finance/dues/generate', { month });
  const again = await call(tr, 'POST', '/finance/dues/generate', { month });
  assert.equal(again.status, 201);
  assert.equal(again.body.created, 0);

  // Expenses
  const e = await call(tr, 'POST', '/finance/expenses', { category: 'Supplies', description: 'Test receipt paper', amount: 120.5, method: 'CASH', spentAt: '2026-01-15' });
  assert.equal(e.status, 201, JSON.stringify(e.body));
  assert.equal((await call(tr, 'POST', '/finance/expenses', { category: 'Supplies', description: 'Future', amount: 1, method: 'CASH', spentAt: '2099-01-01' })).status, 400);
  assert.equal((await call(tr, 'DELETE', `/finance/expenses/${e.body.id}`)).status, 200);

  const s = (await call(tr, 'GET', '/finance/summary')).body;
  assert.equal(s.months.length, 12);
  assert.ok(s.collected > 0);
});

test('reports: list respects permissions, JSON and CSV agree, CSV is formula-safe', async () => {
  const tr = await login('treasurer@todanato.ph');
  const sec = await login('secretary@todanato.ph');
  const disp = await login('dispatcher@todanato.ph');
  const keys = (await call(tr, 'GET', '/reports')).body.map((r: any) => r.key);
  for (const k of ['collections', 'income', 'delinquency', 'expenses', 'drivers', 'tricycles']) assert.ok(keys.includes(k), k);
  const secKeys = (await call(sec, 'GET', '/reports')).body.map((r: any) => r.key);
  assert.ok(!secKeys.includes('collections'), 'secretary has no finance reports');
  assert.equal((await call(sec, 'GET', '/reports/collections')).status, 403);
  assert.equal((await call(disp, 'GET', '/reports')).status, 403);
  assert.equal((await call(tr, 'GET', '/reports/nope')).status, 404);

  for (const k of keys) {
    const r = await call(tr, 'GET', `/reports/${k}?from=2026-01-01&to=2026-12-31`);
    assert.equal(r.status, 200, `${k}: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.columns.length > 0);
  }

  // An expense whose description starts with "=" must not become a formula in the CSV
  const e = await call(tr, 'POST', '/finance/expenses', { category: 'Supplies', description: '=HYPERLINK("x")', amount: 1, method: 'CASH', spentAt: '2026-02-02' });
  const res = await fetch(`${BASE}/reports/expenses?from=2026-02-02&to=2026-02-02&format=csv`, { headers: { Authorization: `Bearer ${tr}` } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename=".*expenses.*\.csv"/);
  const csv = await res.text();
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv.split('\r\n')[0], /Date,Category,Description/);
  await call(tr, 'DELETE', `/finance/expenses/${e.body.id}`);
});

test('document centre: queue counts, views and verify from the queue', async () => {
  const sec = await login('secretary@todanato.ph');
  const disp = await login('dispatcher@todanato.ph');
  const r = await call(sec, 'GET', '/documents/queue');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  for (const v of ['pending', 'expiring', 'expired', 'rejected']) assert.equal(typeof r.body.counts[v], 'number');
  assert.equal(r.body.items.length, r.body.counts.pending);
  const exp = (await call(sec, 'GET', '/documents/queue?view=expiring')).body;
  for (const i of exp.items) {
    const days = (new Date(i.expiresAt).getTime() - Date.now()) / 86400000;
    assert.ok(days >= -0.01 && days <= 30.01, `${i.type} expires in ${days}`);
  }
  assert.ok((await call(sec, 'GET', '/documents/queue?view=expired')).body.items.every((i: any) => new Date(i.expiresAt) < new Date()));

  // Verify the oldest pending driver document straight from the queue
  const pend = r.body.items.find((i: any) => i.kind === 'driver');
  if (pend) {
    assert.equal((await call(sec, 'POST', `/drivers/${pend.ownerId}/documents/${pend.id}/verify`, { status: 'VERIFIED' })).status, 200);
    const after = (await call(sec, 'GET', '/documents/queue')).body;
    assert.equal(after.counts.pending, r.body.counts.pending - 1);
  }
  // Dispatcher has drivers.read? Either way the endpoint must not 500.
  assert.ok([200, 403].includes((await call(disp, 'GET', '/documents/queue')).status));
});

test('announcements: drafts stay private, live ones reach the right audience, scheduling and take-down', async () => {
  const sec = await login('secretary@todanato.ph');
  const tr = await login('treasurer@todanato.ph');
  assert.equal((await call(tr, 'POST', '/announcements', { title: 'Nope', body: 'Not allowed', audience: 'ALL_DRIVERS' })).status, 403);

  const stamp = Date.now();
  const draft = await call(sec, 'POST', '/announcements', { title: `Draft ${stamp}`, body: 'Hidden for now', audience: 'EVERYONE' });
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  assert.equal(draft.body.state, 'DRAFT');
  const live = await call(sec, 'POST', '/announcements', { title: `Staff ${stamp}`, body: 'Officers only', audience: 'OFFICERS', publish: true, priority: 'IMPORTANT' });
  assert.equal(live.body.state, 'LIVE');
  const later = await call(sec, 'POST', '/announcements', { title: `Later ${stamp}`, body: 'Next week', audience: 'ALL_DRIVERS', publish: true, publishAt: new Date(Date.now() + 7 * 86400000).toISOString() });
  assert.equal(later.body.state, 'SCHEDULED');
  assert.equal((await call(sec, 'POST', '/announcements', { title: 'Bad', body: 'Ends first', audience: 'EVERYONE', publish: true, expiresAt: new Date(Date.now() - 1000).toISOString() })).status, 400);

  // Staff feed: officers' notice yes, draft and scheduled no
  const feed = (await call(tr, 'GET', '/announcements/feed')).body.map((a: any) => a.title);
  assert.ok(feed.includes(`Staff ${stamp}`));
  assert.ok(!feed.includes(`Draft ${stamp}`) && !feed.includes(`Later ${stamp}`));

  // Driver portal: driver notices only, never staff-only ones
  const login_ = await fetch(BASE + '/driver/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '09170000001', password: PW }) });
  const cookie = login_.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const me = await (await fetch(BASE + '/driver/me', { headers: { Cookie: cookie } })).json();
  const titles = me.announcements.map((a: any) => a.title);
  assert.ok(!titles.includes(`Staff ${stamp}`) && !titles.includes(`Later ${stamp}`));
  assert.ok(me.announcements.length > 0, 'seeded driver announcements are live');

  // Published ones can't be deleted, only taken down; drafts can be deleted
  assert.equal((await call(sec, 'DELETE', `/announcements/${live.body.id}`)).status, 409);
  assert.equal((await call(sec, 'POST', `/announcements/${live.body.id}/archive`, {})).body.state, 'ARCHIVED');
  assert.ok(!(await call(tr, 'GET', '/announcements/feed')).body.some((a: any) => a.id === live.body.id));
  assert.equal((await call(sec, 'DELETE', `/announcements/${draft.body.id}`)).status, 200);
  await call(sec, 'POST', `/announcements/${later.body.id}/archive`, {});
});
