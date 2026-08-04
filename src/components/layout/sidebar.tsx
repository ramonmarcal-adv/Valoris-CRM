'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { useTotalUnread } from '@/hooks/use-total-unread';
import { useUnreadNotifications } from '@/hooks/use-unread-notifications';
import { useSidebarState } from '@/hooks/use-sidebar-state';
import {
  Bell,
  Bot,
  Crown,
  GitBranch,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
  Radio,
  Settings,
  Shield,
  User,
  UserCog,
  Users,
  UsersRound,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import type { AccountRole } from '@/lib/auth/roles';

// Per-role chip metadata used in the sidebar's account strip + the
// Members tab roster. Keeping this near both consumers in a single
// place avoids drift between the two surfaces — when a designer
// wants to recolour "agent" rows, this is the one diff.
const ROLE_CHIP: Record<
  AccountRole,
  { icon: typeof Crown; labelKey: string; className: string }
> = {
  owner: {
    icon: Crown,
    labelKey: 'roleOwner',
    // Amber: scarce, immutable, "the boss" — gets visual emphasis.
    className: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  },
  admin: {
    icon: Shield,
    labelKey: 'roleAdmin',
    // Primary-tinted: significant but not as scarce as owner.
    className: 'border-primary/40 bg-primary/10 text-primary',
  },
  agent: {
    icon: UserCog,
    labelKey: 'roleAgent',
    // Neutral slate: the operational default.
    className: 'border-border bg-muted text-foreground',
  },
  viewer: {
    icon: User,
    labelKey: 'roleViewer',
    // Muted slate: read-only role; visually quieter than agent.
    className: 'border-border bg-card text-muted-foreground',
  },
};
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface NavItem {
  href: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
  /**
   * When true, the nav row renders a small "Beta" chip after the label.
   * Purely informational — doesn't affect routing or access.
   */
  beta?: boolean;
}

const navItems: NavItem[] = [
  { href: '/dashboard', labelKey: 'dashboard', icon: LayoutDashboard },
  { href: '/inbox', labelKey: 'inbox', icon: MessageSquare },
  { href: '/notifications', labelKey: 'notifications', icon: Bell },
  { href: '/contacts', labelKey: 'contacts', icon: Users },
  { href: '/pipelines', labelKey: 'pipelines', icon: GitBranch },
  { href: '/broadcasts', labelKey: 'broadcasts', icon: Radio },
  { href: '/automations', labelKey: 'automations', icon: Zap },
  { href: '/flows', labelKey: 'flows', icon: Workflow, beta: true },
  { href: '/agents', labelKey: 'aiAgents', icon: Bot },
];

const bottomNavItems = [
  { href: '/settings', labelKey: 'settings', icon: Settings },
];

interface SidebarProps {
  /** Controlled on mobile by the Header's hamburger button. Ignored on lg+. */
  open?: boolean;
  onClose?: () => void;
}

import { useTranslations } from 'next-intl';

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const t = useTranslations('Sidebar');
  const pathname = usePathname();
  const { profile, profileLoading, account, accountRole, signOut } = useAuth();
  const totalUnread = useTotalUnread();
  const unreadNotifications = useUnreadNotifications();
  // Tracks the specific URL that failed to load (not just a boolean) so
  // the fallback icon self-heals the moment an admin fixes the URL in
  // Settings → Branding, without needing an effect to reset it.
  const [brokenLogoUrl, setBrokenLogoUrl] = useState<string | null>(null);
  const logoUrl = account?.branding_logo_url ?? null;
  const showLogo = !!logoUrl && logoUrl !== brokenLogoUrl;
  // Only surface the account-name strip when it actually carries
  // information. A solo user's personal account is named after them
  // (the 017 signup trigger seeds it from `full_name`), so showing it
  // here would just duplicate the user name in the footer below. Once
  // the account is renamed or the user joins a shared account, the
  // name diverges and the strip becomes meaningful — that's the signal
  // we gate on. Wait for the profile fetch to settle first, otherwise
  // the strip flashes in once the row resolves (a layout jump).
  const showAccountStrip =
    !profileLoading && !!account?.name && account.name !== profile?.full_name;

  // ------------------------------------------------------------
  // Collapse / pin (desktop only — the mobile drawer always shows
  // full content regardless of these). `collapsed` + `pinned` persist
  // to localStorage (see useSidebarState); `hoverExpanded` is purely
  // ephemeral local state for the "peek" flyout.
  //
  // railOnDesktop = the bare icon-only rail is showing (no hover).
  // Every piece of content that should disappear in that state uses a
  // *CSS* `lg:hidden` class gated on this — never a JS conditional
  // unmount — so a stray `collapsed=true` in localStorage (e.g. the
  // same browser used in desktop mode once) can never hide content on
  // an actual mobile viewport, where `lg:` classes simply don't apply.
  // ------------------------------------------------------------
  const { collapsed, pinned, toggleCollapsed, togglePinned } =
    useSidebarState();
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canHoverExpand = collapsed && !pinned;
  const railOnDesktop = collapsed && !hoverExpanded;
  const isFloating = collapsed && hoverExpanded;

  const handleMouseEnter = useCallback(() => {
    if (!canHoverExpand) return;
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setHoverExpanded(true);
  }, [canHoverExpand]);

  const handleMouseLeave = useCallback(() => {
    if (!canHoverExpand) return;
    // A short grace period, not an instant snap-back — brushing past
    // the edge or moving toward the flyout's own content shouldn't
    // retract it mid-motion.
    hoverTimeoutRef.current = setTimeout(() => setHoverExpanded(false), 150);
  }, [canHoverExpand]);

  // Pinning while a flyout is open, or unpinning, shouldn't leave a
  // stale hover-expanded state hanging around.
  useEffect(() => {
    if (!canHoverExpand) setHoverExpanded(false);
  }, [canHoverExpand]);

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    };
  }, []);

  // Close the drawer when route changes — users opened it to navigate,
  // so once they pick a destination the drawer should get out of the way.
  useEffect(() => {
    onClose?.();
    // Only pathname drives this — onClose identity doesn't need to re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Lock body scroll and allow Escape to close while the drawer is open on
  // mobile. No-ops on desktop because the sidebar isn't positioned there.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop — only exists on mobile and only when open. Clicking
          it closes the drawer. Hidden from lg+ since the sidebar is
          part of the main flex row there. */}
      <button
        type="button"
        aria-label={t('closeMenu')}
        onClick={onClose}
        className={cn(
          'bg-background/70 fixed inset-0 z-30 backdrop-blur-sm transition-opacity lg:hidden',
          open
            ? 'pointer-events-auto opacity-100'
            : 'pointer-events-none opacity-0'
        )}
      />

      {/* Desktop spacer — a plain, non-hoverable flex child that
          reserves real layout space equal to the *settled* width
          (ignoring any temporary hover flyout). The `<aside>` itself
          is always `fixed` so a hover flyout can overlay the page
          without shifting it — this element is what actually makes
          room for it in the flex row. */}
      <div
        aria-hidden
        className={cn(
          'hidden shrink-0 transition-[width] duration-200 ease-out lg:block',
          collapsed ? 'lg:w-16' : 'lg:w-60'
        )}
      />

      <aside
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={cn(
          // Mobile: fixed drawer that slides in from the left.
          'border-border bg-card fixed inset-y-0 left-0 z-40 flex h-full w-64 flex-col border-r',
          'transition-[transform,width,box-shadow] duration-200 ease-out will-change-transform',
          open ? 'translate-x-0' : '-translate-x-full',
          // Desktop: always positioned (not a flex child — the spacer
          // above handles layout space) so width can change without
          // reflowing the page, and so a hover flyout can overlay.
          'lg:translate-x-0',
          collapsed ? 'lg:w-16' : 'lg:w-60',
          isFloating && 'lg:w-60 lg:shadow-2xl lg:shadow-black/30'
        )}
        aria-label={t('primaryNavAria')}
      >
        {/* Logo row. On mobile we put a close button here; on desktop the
              close button is hidden since the sidebar is always-visible. */}
        <div
          className={cn(
            'border-border flex h-14 shrink-0 items-center justify-between gap-2 border-b px-4',
            railOnDesktop && 'lg:justify-center lg:px-2'
          )}
        >
          <Link
            href="/dashboard"
            className={cn(
              'flex min-w-0 items-center gap-2',
              railOnDesktop && 'lg:justify-center'
            )}
          >
            <div className="bg-primary text-primary-foreground flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg">
              {showLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl!}
                  alt=""
                  className="h-full w-full object-cover"
                  onError={() => setBrokenLogoUrl(logoUrl)}
                />
              ) : (
                <MessageSquare className="h-4 w-4" />
              )}
            </div>
            <span
              className={cn(
                'text-foreground truncate text-sm font-semibold',
                railOnDesktop && 'lg:hidden'
              )}
            >
              {account?.branding_name || t('title')}
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-1">
            {/* Pin toggle — desktop only, and only while the sidebar is
                  showing full content (bare rail has no room for it; hover
                  to peek reveals it again). Only meaningful once collapsed,
                  but stays reachable any time so the preference is easy to
                  set before collapsing for the first time. */}
            <button
              type="button"
              onClick={togglePinned}
              aria-pressed={pinned}
              aria-label={t(pinned ? 'unpinMenu' : 'pinMenu')}
              title={t(pinned ? 'unpinMenu' : 'pinMenu')}
              className={cn(
                'text-muted-foreground hover:bg-muted hover:text-foreground hidden h-8 w-8 items-center justify-center rounded-md transition-colors lg:flex',
                railOnDesktop && 'lg:hidden'
              )}
            >
              {pinned ? (
                <Pin className="h-4 w-4 fill-current" />
              ) : (
                <PinOff className="h-4 w-4" />
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('closeMenu')}
              className="text-muted-foreground hover:bg-muted hover:text-foreground flex h-9 w-9 items-center justify-center rounded-md lg:hidden"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Collapse / expand handle — a small circular button straddling
              the sidebar's right border, desktop only. Always in the same
              spot regardless of rail/full/flyout state. */}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={t(collapsed ? 'expandMenu' : 'collapseMenu')}
          title={t(collapsed ? 'expandMenu' : 'collapseMenu')}
          className="border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-primary absolute top-16 -right-3 hidden h-6 w-6 items-center justify-center rounded-full border shadow-sm transition-colors lg:flex"
        >
          {collapsed ? (
            <PanelLeftOpen className="h-3.5 w-3.5" />
          ) : (
            <PanelLeftClose className="h-3.5 w-3.5" />
          )}
        </button>

        {/* Main navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="flex flex-col gap-1">
            {navItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== '/dashboard' && pathname.startsWith(item.href));

              const showUnreadDot =
                item.href === '/inbox' && totalUnread > 0 && !isActive;

              // Unlike the inbox dot, the notifications count stays visible
              // even while the page is active — it reflects unread state
              // (cleared by marking notifications read), not "currently
              // viewing this section".
              const showNotificationBadge =
                item.href === '/notifications' && unreadNotifications > 0;

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      // Taller on mobile so fingers can hit the row reliably (≥44px).
                      'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      railOnDesktop && 'lg:justify-center lg:px-0'
                    )}
                  >
                    <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
                      <item.icon className="h-4 w-4" />
                      {(showUnreadDot || showNotificationBadge) && (
                        <span
                          className={cn(
                            'bg-primary absolute -top-0.5 -right-0.5 hidden h-1.5 w-1.5 rounded-full',
                            railOnDesktop && 'lg:block'
                          )}
                        />
                      )}
                    </span>
                    <span
                      className={cn('flex-1', railOnDesktop && 'lg:hidden')}
                    >
                      {t(item.labelKey as string)}
                    </span>
                    {item.beta && (
                      <span
                        aria-label={t('beta')}
                        className={cn(
                          'rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-amber-300 uppercase',
                          railOnDesktop && 'lg:hidden'
                        )}
                      >
                        {t('beta')}
                      </span>
                    )}
                    {showUnreadDot && (
                      <span
                        aria-label={t('unreadConversations', {
                          count: totalUnread,
                        })}
                        className={cn(
                          'relative flex h-2 w-2',
                          railOnDesktop && 'lg:hidden'
                        )}
                      >
                        <span className="bg-primary absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" />
                        <span className="bg-primary relative inline-flex h-2 w-2 rounded-full" />
                      </span>
                    )}
                    {showNotificationBadge && (
                      <span
                        aria-label={t('unreadNotifications', {
                          count: unreadNotifications,
                        })}
                        className={cn(
                          'bg-primary text-primary-foreground flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-semibold',
                          railOnDesktop && 'lg:hidden'
                        )}
                      >
                        {unreadNotifications > 9 ? '9+' : unreadNotifications}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="border-border my-4 border-t" />

          <ul className="flex flex-col gap-1">
            {bottomNavItems.map((item) => {
              const isActive = pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      railOnDesktop && 'lg:justify-center lg:px-0'
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className={cn(railOnDesktop && 'lg:hidden')}>
                      {t(item.labelKey as string)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* User section */}
        <div className="border-border shrink-0 border-t p-3">
          {/* Account name display — surfaced only when the account
                name differs from the user's own name (see
                `showAccountStrip`). For a default solo account the two
                match, so we hide it to avoid duplicating the user name
                below; for renamed or shared accounts it tells the user
                which account they're acting in. */}
          {showAccountStrip && account?.name ? (
            <div
              className={cn(
                'text-muted-foreground mb-2 flex items-center gap-2 px-3 text-xs',
                railOnDesktop && 'lg:hidden'
              )}
            >
              <UsersRound className="size-3.5 shrink-0" />
              {/* `title=` exposes the full name on hover when it
                    gets truncated (long account names + narrow
                    sidebars). Cheap a11y win. */}
              <span className="truncate" title={account.name}>
                {account.name}
              </span>
              {accountRole
                ? // Always render the chip — owners used to be
                  // invisible here, which made them indistinguishable
                  // from admins at a glance. Now everyone sees their
                  // role (with a colour cue) regardless of tier.
                  (() => {
                    const meta = ROLE_CHIP[accountRole];
                    const Icon = meta.icon;
                    return (
                      <span
                        className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium tracking-wider uppercase ${meta.className}`}
                      >
                        <Icon className="size-3" />
                        {t(meta.labelKey as string)}
                      </span>
                    );
                  })()
                : null}
            </div>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                'hover:bg-muted/60 focus:bg-muted/60 data-popup-open:bg-muted/60 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors focus:outline-none',
                railOnDesktop && 'lg:justify-center lg:px-0'
              )}
            >
              <Avatar className="size-8 shrink-0">
                {profile?.avatar_url ? (
                  <AvatarImage
                    src={profile.avatar_url}
                    alt={profile.full_name ?? t('defaultAvatar')}
                  />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                  {profile?.full_name?.charAt(0)?.toUpperCase() ??
                    profile?.email?.charAt(0)?.toUpperCase() ??
                    'U'}
                </AvatarFallback>
              </Avatar>
              <div
                className={cn('min-w-0 flex-1', railOnDesktop && 'lg:hidden')}
              >
                <p className="text-foreground truncate text-sm font-medium">
                  {profile?.full_name ?? t('defaultUser')}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {profile?.email ?? ''}
                </p>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="top"
              sideOffset={6}
              className="bg-popover text-popover-foreground ring-border min-w-56"
            >
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=profile"
                    onClick={onClose}
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <User className="size-4" />
                {t('menuProfile')}
              </DropdownMenuItem>
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=whatsapp"
                    onClick={onClose}
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <Settings className="size-4" />
                {t('menuSettings')}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                onClick={signOut}
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              >
                <LogOut className="size-4" />
                {t('menuSignOut')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </>
  );
}
