import { NavLink } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { PRIMARY_NAV, SECONDARY_NAV, type NavItem } from './nav-items';
import { useUIStore } from '@/store/ui.store';
import { useAuthStore } from '@/store/auth.store';
import { Tooltip } from '@/components/ui/Tooltip';
import { APP_NAME } from '@/constants/app';
import { cn } from '@/lib/utils';

function SidebarLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const Icon = item.icon;
  const link = (
    <NavLink
      to={item.to}
      end={!item.matchPrefix}
      className={({ isActive }) =>
        cn(
          'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
          collapsed && 'justify-center px-0',
          isActive
            ? 'bg-brand-500/12 text-brand-400'
            : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
        )
      }
    >
      <Icon className="h-5 w-5 shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </NavLink>
  );

  return collapsed ? (
    <Tooltip content={item.label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

/** Desktop sidebar. Hidden below lg; mobile uses MobileSidebar. */
export function Sidebar() {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const user = useAuthStore((s) => s.user);
  const primaryNav = PRIMARY_NAV.filter((item) => !item.roles || (user && item.roles.includes(user.role)));
  const secondaryNav = SECONDARY_NAV.filter((item) => !item.roles || (user && item.roles.includes(user.role)));

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-border bg-surface backdrop-blur-xl transition-[width] duration-300 ease-out-expo lg:flex',
        collapsed ? 'w-20' : 'w-64',
      )}
    >
      <div className={cn('flex h-16 items-center gap-2.5 px-5', collapsed && 'justify-center px-0')}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-brand shadow-glow">
          <span className="text-lg">💊</span>
        </div>
        {!collapsed && <span className="truncate text-sm font-semibold text-text-primary">{APP_NAME}</span>}
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
        {primaryNav.map((item) => (
          <SidebarLink key={item.to} item={item} collapsed={collapsed} />
        ))}
        <div className="my-2 border-t border-border" />
        {secondaryNav.map((item) => (
          <SidebarLink key={item.to} item={item} collapsed={collapsed} />
        ))}
      </nav>

      <button
        type="button"
        onClick={toggleSidebar}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="m-3 flex items-center justify-center gap-2 rounded-xl border border-border py-2 text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
      >
        <ChevronLeft className={cn('h-4 w-4 transition-transform', collapsed && 'rotate-180')} />
        {!collapsed && <span className="text-xs font-medium">Collapse</span>}
      </button>
    </aside>
  );
}
