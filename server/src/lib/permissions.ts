// Permission catalog and default role grants.
// Roles and their grants live in the database (Role / RolePermission) and can be
// edited from Settings → Roles & permissions. This file is the seed + catalog.

export const PERMISSIONS = {
  // Dashboard
  'dashboard.view': ['Dashboard', 'View the dashboard'],
  // Users & roles
  'users.read': ['Users', 'View user accounts'],
  'users.manage': ['Users', 'Create, edit, activate and deactivate users'],
  'roles.manage': ['Users', 'Edit role permissions'],
  'sessions.manage': ['Users', 'View and revoke sessions of other users'],
  // Associations
  'associations.read': ['TODA profile', 'View the TODA profile and members'],
  'associations.update': ['TODA profile', 'Edit TODA information'],
  'associations.officers': ['TODA profile', 'Assign TODA officers'],
  'memberships.read': ['Associations', 'View memberships'],
  'memberships.manage': ['Associations', 'Approve, suspend and end memberships'],
  // Drivers
  'drivers.read': ['Drivers', 'View driver records'],
  'drivers.create': ['Drivers', 'Add drivers'],
  'drivers.update': ['Drivers', 'Edit driver information'],
  'drivers.approve': ['Drivers', 'Approve or reject driver applications'],
  'drivers.status': ['Drivers', 'Activate, deactivate and suspend drivers'],
  'drivers.delete': ['Drivers', 'Archive driver records'],
  'drivers.export': ['Drivers', 'Export driver records'],
  'drivers.pii': ['Drivers', 'See full personal details (address, birth date, emergency contact)'],
  'documents.upload': ['Documents', 'Upload driver and vehicle documents'],
  'documents.verify': ['Documents', 'Verify or reject documents'],
  // Vehicles
  'vehicles.read': ['Vehicles', 'View vehicles'],
  'vehicles.create': ['Vehicles', 'Register vehicles'],
  'vehicles.update': ['Vehicles', 'Edit vehicles and change status'],
  'vehicles.assign': ['Vehicles', 'Assign and reassign drivers'],
  'vehicles.delete': ['Vehicles', 'Archive vehicles'],
  'maintenance.manage': ['Vehicles', 'Record maintenance and repairs'],
  // Finance (Phase 2)
  'finance.read': ['Finance', 'View payments and balances'],
  'finance.record': ['Finance', 'Record payments and issue receipts'],
  'finance.void': ['Finance', 'Void and correct payments'],
  'expenses.manage': ['Finance', 'Record expenses'],
  // Dispatch (Phase 3)
  'dispatch.view': ['Dispatch', 'Monitor rides and driver locations'],
  'dispatch.intervene': ['Dispatch', 'Reassign or cancel rides'],
  // Reports, announcements, incidents
  'reports.view': ['Reports', 'View and export reports'],
  'announcements.manage': ['Announcements', 'Create and publish announcements'],
  'incidents.read': ['Incidents', 'View incidents and complaints'],
  'incidents.manage': ['Incidents', 'Handle incidents and complaints'],
  // Audit & settings
  'audit.read': ['Audit', 'View audit logs'],
  'settings.manage': ['Settings', 'Edit system settings'],
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
const ALL = Object.keys(PERMISSIONS) as PermissionKey[];

const READ_ONLY: PermissionKey[] = ALL.filter((p) => /\.(read|view)$/.test(p));

export const ROLES: {
  key: string;
  name: string;
  description: string;
  scope: 'GLOBAL' | 'ORGANIZATION' | 'ASSOCIATION';
  permissions: PermissionKey[];
}[] = [
  {
    key: 'SUPER_ADMIN',
    name: 'Super Administrator',
    description: 'Full access, including roles and permissions.',
    scope: 'GLOBAL',
    permissions: ALL,
  },
  {
    key: 'ASSOC_PRESIDENT',
    name: 'President',
    description: 'Runs the TODA: members, drivers, tricycles, officers and staff accounts.',
    scope: 'ASSOCIATION',
    permissions: [
      'dashboard.view', 'users.read', 'users.manage', 'sessions.manage',
      'associations.read', 'associations.update', 'associations.officers',
      'memberships.read', 'memberships.manage',
      'drivers.read', 'drivers.create', 'drivers.update', 'drivers.approve', 'drivers.status', 'drivers.export', 'drivers.pii',
      'documents.upload', 'documents.verify',
      'vehicles.read', 'vehicles.create', 'vehicles.update', 'vehicles.assign', 'maintenance.manage',
      'finance.read', 'dispatch.view', 'reports.view', 'announcements.manage',
      'incidents.read', 'incidents.manage', 'audit.read',
    ],
  },
  {
    key: 'SECRETARY',
    name: 'Secretary',
    description: 'Keeps member, driver and tricycle records.',
    scope: 'ASSOCIATION',
    permissions: [
      'dashboard.view',
      'associations.read', 'memberships.read', 'memberships.manage',
      'drivers.read', 'drivers.create', 'drivers.update', 'drivers.export', 'drivers.pii',
      'documents.upload', 'documents.verify',
      'vehicles.read', 'vehicles.create', 'vehicles.update', 'vehicles.assign', 'maintenance.manage',
      'reports.view', 'announcements.manage', 'incidents.read',
    ],
  },
  {
    key: 'TREASURER',
    name: 'Treasurer',
    description: 'Records collections and expenses.',
    scope: 'ASSOCIATION',
    permissions: [
      'dashboard.view', 'associations.read', 'memberships.read',
      'drivers.read', 'vehicles.read',
      'finance.read', 'finance.record', 'finance.void', 'expenses.manage',
      'reports.view',
    ],
  },
  {
    key: 'DISPATCHER',
    name: 'Dispatcher',
    description: 'Monitors rides and drivers on the road.',
    scope: 'ASSOCIATION',
    permissions: [
      'dashboard.view', 'associations.read',
      'drivers.read', 'vehicles.read',
      'dispatch.view', 'dispatch.intervene', 'incidents.read',
    ],
  },
  {
    key: 'AUDITOR',
    name: 'Auditor',
    description: 'Read-only access to records, finances and audit logs.',
    scope: 'ASSOCIATION',
    permissions: [...READ_ONLY, 'drivers.export'],
  },
];
