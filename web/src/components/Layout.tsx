import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, Bike, Building2, ShieldCheck, ScrollText, Settings, Wallet, BarChart3, Megaphone, MapPinned, AlertOctagon,
  FileText, Menu as MenuIcon, X, Moon, Sun, LogOut, KeyRound, UserCog, ChevronDown,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { Avatar } from './ui/misc';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from './ui/tabs';

type NavItem = { to: string; label: string; icon: typeof Users; perm?: string; phase?: number };

const NAV: { section: string; items: NavItem[] }[] = [
  { section: 'Overview', items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, perm: 'dashboard.view' }] },
  {
    section: 'Records',
    items: [
      { to: '/drivers', label: 'Drivers', icon: Users, perm: 'drivers.read' },
      { to: '/vehicles', label: 'Tricycles', icon: Bike, perm: 'vehicles.read' },
      { to: '/associations', label: 'Associations', icon: Building2, perm: 'associations.read' },
    ],
  },
  {
    section: 'Operations',
    items: [
      { to: '/dispatch', label: 'Dispatch', icon: MapPinned, perm: 'dispatch.view', phase: 3 },
      { to: '/finance', label: 'Finance', icon: Wallet, perm: 'finance.read', phase: 2 },
      { to: '/documents', label: 'Documents', icon: FileText, perm: 'drivers.read', phase: 2 },
      { to: '/reports', label: 'Reports', icon: BarChart3, perm: 'reports.view', phase: 2 },
      { to: '/announcements', label: 'Announcements', icon: Megaphone, perm: 'announcements.manage', phase: 2 },
      { to: '/incidents', label: 'Incidents', icon: AlertOctagon, perm: 'incidents.read', phase: 2 },
    ],
  },
  {
    section: 'Administration',
    items: [
      { to: '/users', label: 'Users & roles', icon: ShieldCheck, perm: 'users.read' },
      { to: '/audit', label: 'Audit log', icon: ScrollText, perm: 'audit.read' },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('toms-theme', dark ? 'dark' : 'light'); } catch { /* ignore */ }
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { can, user } = useAuth();
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <Link to="/" onClick={onNavigate} className="flex h-16 items-center gap-2.5 px-5">
        <img src="/favicon.svg" alt="" className="size-8" />
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-wide">TOMS</div>
          <div className="text-[11px] text-sidebar-muted">Tricycle Organization Mgmt</div>
        </div>
      </Link>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
        {NAV.map((s) => {
          const items = s.items.filter((i) => !i.perm || can(i.perm));
          if (!items.length) return null;
          return (
            <div key={s.section}>
              <div className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">{s.section}</div>
              <ul className="space-y-0.5">
                {items.map((i) =>
                  i.phase ? (
                    <li key={i.to}>
                      <span className="flex cursor-not-allowed items-center gap-3 rounded-md px-2 py-2 text-sm text-sidebar-muted/70" title={`Coming in Phase ${i.phase}`}>
                        <i.icon className="size-4" />
                        <span className="flex-1">{i.label}</span>
                        <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px]">Phase {i.phase}</span>
                      </span>
                    </li>
                  ) : (
                    <li key={i.to}>
                      <NavLink
                        to={i.to}
                        end={i.to === '/'}
                        onClick={onNavigate}
                        className={({ isActive }) => cn('flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors hover:bg-white/5', isActive && 'bg-sidebar-active font-medium text-white')}
                      >
                        <i.icon className="size-4" />
                        {i.label}
                      </NavLink>
                    </li>
                  ),
                )}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-white/10 p-4 text-xs text-sidebar-muted">
        <div className="truncate font-medium text-sidebar-foreground">{user?.organization?.name ?? 'All organizations'}</div>
        <div className="truncate">{user?.association ? user.association.name : user?.role.scope === 'GLOBAL' ? 'System-wide access' : 'All associations'}</div>
      </div>
    </div>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block"><Sidebar /></aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 shadow-xl">
            <Sidebar onNavigate={() => setOpen(false)} />
            <button className="absolute right-3 top-5 text-sidebar-foreground" onClick={() => setOpen(false)} aria-label="Close menu"><X className="size-5" /></button>
          </aside>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-card/90 px-4 backdrop-blur sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><MenuIcon /></Button>
          <div className="min-w-0 flex-1">
            {user?.association && <div className="truncate text-sm font-medium">{user.association.name}</div>}
          </div>
          <Button variant="ghost" size="icon" onClick={toggle} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}>{dark ? <Sun /> : <Moon />}</Button>
          <Menu>
            <MenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-md p-1 pr-2 hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Avatar name={user?.fullName ?? '?'} className="size-8" />
                <div className="hidden text-left leading-tight sm:block">
                  <div className="max-w-[160px] truncate text-sm font-medium">{user?.fullName}</div>
                  <div className="text-xs text-muted-foreground">{user?.role.name}</div>
                </div>
                <ChevronDown className="hidden size-4 text-muted-foreground sm:block" />
              </button>
            </MenuTrigger>
            <MenuContent>
              <MenuLabel>{user?.email}</MenuLabel>
              <MenuSeparator />
              <MenuItem onSelect={() => nav('/settings?tab=account')}><UserCog /> My account</MenuItem>
              <MenuItem onSelect={() => nav('/settings?tab=security')}><KeyRound /> Password & sessions</MenuItem>
              <MenuSeparator />
              <MenuItem danger onSelect={async () => { await logout(); nav('/login'); }}><LogOut /> Sign out</MenuItem>
            </MenuContent>
          </Menu>
        </header>
        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
