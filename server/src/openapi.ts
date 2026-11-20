// OpenAPI 3.1 description of the admin API (Phase 1).
// Mobile driver/passenger endpoints (/api/mobile/*) are added in Phase 3.

type Op = [method: string, path: string, tag: string, summary: string, permission?: string, body?: string];

const ops: Op[] = [
  ['post', '/auth/login', 'Auth', 'Sign in with email and password. Returns an access token; sets a refresh cookie.', undefined, 'Login'],
  ['post', '/auth/refresh', 'Auth', 'Exchange the refresh cookie (or body.refreshToken) for a new access token. Rotates the refresh token.'],
  ['post', '/auth/logout', 'Auth', 'End the current session'],
  ['post', '/auth/forgot-password', 'Auth', 'Request a password reset link'],
  ['post', '/auth/reset-password', 'Auth', 'Set a new password using a reset token'],
  ['get', '/auth/me', 'Auth', 'Current user, role and permissions'],
  ['post', '/auth/change-password', 'Auth', 'Change own password (signs out other sessions)'],
  ['get', '/auth/sessions', 'Auth', 'List own active sessions'],
  ['delete', '/auth/sessions/{id}', 'Auth', 'Revoke one of own sessions'],
  ['get', '/auth/login-history', 'Auth', 'Own recent sign-in attempts'],

  ['get', '/dashboard/summary', 'Dashboard', 'Headline counts and totals', 'dashboard.view'],
  ['get', '/dashboard/activity', 'Dashboard', 'Chart series. Query: period=daily|weekly|monthly', 'dashboard.view'],
  ['get', '/dashboard/feed', 'Dashboard', 'Recent transactions, activity, pending approvals, expiring documents, live drivers', 'dashboard.view'],

  ['get', '/users', 'Users', 'List users (paginated)', 'users.read'],
  ['post', '/users', 'Users', 'Create user; returns a temporary password if none given', 'users.manage'],
  ['get', '/users/{id}', 'Users', 'User detail with login history and sessions', 'users.read'],
  ['patch', '/users/{id}', 'Users', 'Edit user', 'users.manage'],
  ['post', '/users/{id}/status', 'Users', 'Activate or deactivate. Body: { active: boolean }', 'users.manage'],
  ['post', '/users/{id}/reset-password', 'Users', 'Issue a temporary password', 'users.manage'],
  ['delete', '/users/{id}/sessions', 'Users', 'Sign the user out everywhere', 'sessions.manage'],
  ['get', '/roles', 'Roles', 'Roles with their permissions'],
  ['get', '/roles/permissions', 'Roles', 'Permission catalog'],
  ['put', '/roles/{id}/permissions', 'Roles', 'Replace a role\'s permissions', 'roles.manage'],

  ['get', '/associations', 'TODA profile', 'The TODA (a list with one entry)', 'associations.read'],
  ['get', '/associations/{id}', 'TODA profile', 'TODA profile with officers and stats', 'associations.read'],
  ['patch', '/associations/{id}', 'TODA profile', 'Edit the TODA profile', 'associations.update'],
  ['post', '/associations/{id}/officers', 'TODA profile', 'Assign an officer', 'associations.officers'],
  ['post', '/associations/{id}/officers/{officerId}/end', 'TODA profile', 'End an officer\'s term', 'associations.officers'],
  ['get', '/associations/{id}/members', 'TODA profile', 'Membership list', 'memberships.read'],
  ['post', '/associations/{id}/members/{membershipId}/status', 'TODA profile', 'Change a membership status', 'memberships.manage'],

  ['get', '/drivers', 'Drivers', 'List drivers. Query: q, status, application, associationId, licenseExpiring, unassigned, sort, dir, page, pageSize', 'drivers.read'],
  ['get', '/drivers/export', 'Drivers', 'Export the filtered list as CSV', 'drivers.export'],
  ['post', '/drivers', 'Drivers', 'Register a driver (creates a pending membership)', 'drivers.create'],
  ['get', '/drivers/{id}', 'Drivers', 'Full driver profile', 'drivers.read'],
  ['patch', '/drivers/{id}', 'Drivers', 'Edit driver', 'drivers.update'],
  ['post', '/drivers/{id}/application', 'Drivers', 'Approve or reject. Body: { decision: APPROVE|REJECT, reason }', 'drivers.approve'],
  ['post', '/drivers/{id}/status', 'Drivers', 'Activate, deactivate or suspend', 'drivers.status'],
  ['delete', '/drivers/{id}', 'Drivers', 'Archive driver', 'drivers.delete'],
  ['post', '/drivers/{id}/photo', 'Drivers', 'Upload profile photo (multipart: file)', 'drivers.update'],
  ['post', '/drivers/{id}/documents', 'Drivers', 'Upload a document (multipart: file, type, documentNo, expiresAt)', 'documents.upload'],
  ['post', '/drivers/{id}/documents/{docId}/verify', 'Drivers', 'Verify or reject a document', 'documents.verify'],
  ['delete', '/drivers/{id}/documents/{docId}', 'Drivers', 'Delete an unverified document', 'documents.upload'],

  ['get', '/vehicles', 'Vehicles', 'List tricycles. Query: q, status, associationId, inspection, expiring, unassigned', 'vehicles.read'],
  ['post', '/vehicles', 'Vehicles', 'Register a tricycle', 'vehicles.create'],
  ['get', '/vehicles/{id}', 'Vehicles', 'Tricycle profile with assignments, documents, maintenance and history', 'vehicles.read'],
  ['patch', '/vehicles/{id}', 'Vehicles', 'Edit tricycle', 'vehicles.update'],
  ['post', '/vehicles/{id}/status', 'Vehicles', 'Mark operational / under maintenance / inactive', 'vehicles.update'],
  ['post', '/vehicles/{id}/assign', 'Vehicles', 'Assign, reassign or unassign a driver. Body: { driverId|null }', 'vehicles.assign'],
  ['delete', '/vehicles/{id}', 'Vehicles', 'Archive tricycle', 'vehicles.delete'],
  ['post', '/vehicles/{id}/maintenance', 'Vehicles', 'Record maintenance or repair', 'maintenance.manage'],
  ['delete', '/vehicles/{id}/maintenance/{mid}', 'Vehicles', 'Delete maintenance record', 'maintenance.manage'],
  ['post', '/vehicles/{id}/documents', 'Vehicles', 'Upload a document (multipart)', 'documents.upload'],
  ['post', '/vehicles/{id}/documents/{docId}/verify', 'Vehicles', 'Verify or reject a document', 'documents.verify'],
  ['delete', '/vehicles/{id}/documents/{docId}', 'Vehicles', 'Delete an unverified document', 'documents.upload'],

  ['get', '/files/driver-photo/{driverId}', 'Files', 'Driver photo (scope checked)', 'drivers.read'],
  ['get', '/files/driver-document/{docId}', 'Files', 'Driver document file (scope checked)', 'drivers.read'],
  ['get', '/files/vehicle-document/{docId}', 'Files', 'Vehicle document file (scope checked)', 'vehicles.read'],
  ['get', '/audit-logs', 'Audit', 'Audit trail (paginated)', 'audit.read'],
  ['get', '/organizations', 'Settings', 'Organizations visible to the user'],
  ['patch', '/organizations/{id}', 'Settings', 'Edit organization profile', 'settings.manage'],
];

const paths: Record<string, Record<string, unknown>> = {};
for (const [method, p, tag, summary, permission, body] of ops) {
  const params = [...p.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }));
  paths[p] ??= {};
  paths[p][method] = {
    tags: [tag],
    summary,
    description: permission ? `Requires permission \`${permission}\`. Results are limited to the caller's association scope.` : undefined,
    parameters: params.length ? params : undefined,
    security: p.startsWith('/auth/') && !['/auth/me', '/auth/change-password', '/auth/sessions', '/auth/sessions/{id}', '/auth/login-history'].includes(p) ? [] : [{ bearer: [] }],
    requestBody: body ? { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${body}` } } } } : undefined,
    responses: {
      200: { description: 'OK' },
      400: { $ref: '#/components/responses/ValidationError' },
      401: { description: 'Not signed in or session expired' },
      403: { description: 'Missing permission or outside the caller\'s association' },
    },
  };
}

export const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'TODAnaTo API',
    version: '1.0.0-phase1',
    description:
      'REST API shared by the TODAnaTo admin web app and (from Phase 3) the driver and passenger mobile apps. ' +
      'Admin endpoints require a Bearer access token from /auth/login. Mobile tokens use a different audience and cannot call admin endpoints.',
  },
  servers: [{ url: '/api' }],
  components: {
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      Login: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } } },
      Error: { type: 'object', properties: { error: { type: 'string' }, fields: { type: 'object', additionalProperties: { type: 'string' } } } },
    },
    responses: { ValidationError: { description: 'Invalid input', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } },
  },
  paths,
};
