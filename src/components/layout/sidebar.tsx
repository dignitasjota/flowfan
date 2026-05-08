"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { useTheme } from "@/hooks/useTheme";
import { useSession } from "next-auth/react";
import { TeamSwitcher } from "./team-switcher";
import { GlobalSearch } from "./global-search";
import { useRealtimeContext } from "@/hooks/use-realtime";
import Image from "next/image";

// access: "all" = any team member, "manager" = owner+manager, "owner" = owner only
const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: "📊", access: "all" as const },
  { name: "Conversaciones", href: "/conversations", icon: "💬", access: "all" as const },
  { name: "Comentarios", href: "/comments", icon: "🗨️", access: "all" as const },
  { name: "Contactos", href: "/contacts", icon: "👥", access: "all" as const },
  { name: "Segmentos", href: "/segments", icon: "🎯", access: "manager" as const },
  { name: "Revenue", href: "/revenue", icon: "💰", access: "manager" as const },
  { name: "Media Vault", href: "/media", icon: "🖼️", access: "manager" as const },
  { name: "Automatizaciones", href: "/workflows", icon: "⚡", access: "manager" as const },
  { name: "Secuencias", href: "/sequences", icon: "🔄", access: "manager" as const },
  { name: "Content Gaps", href: "/content-gaps", icon: "🔍", access: "manager" as const },
  { name: "Insights", href: "/insights", icon: "📈", access: "manager" as const },
  { name: "Blog → Social", href: "/blog-to-social", icon: "✨", access: "manager" as const },
  { name: "Programados", href: "/scheduled", icon: "⏰", access: "all" as const },
  { name: "Scheduler", href: "/scheduler", icon: "📅", access: "manager" as const },
  { name: "Calendario", href: "/calendar", icon: "🗓️", access: "manager" as const },
  { name: "Broadcasts", href: "/broadcasts", icon: "📢", access: "manager" as const },
  { name: "Equipo", href: "/team", icon: "👤", access: "owner" as const },
  { name: "Billing", href: "/billing", icon: "💳", access: "owner" as const },
  { name: "Configuración", href: "/settings", icon: "⚙️", access: "owner" as const },
];

type SidebarProps = {
  user: { name: string; email: string; role?: string };
};

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const { data: session } = useSession();
  const teamRole = session?.user?.teamRole ?? null;

  // Filter navigation based on team role
  const filteredNav = navigation.filter((item) => {
    if (!teamRole) return true; // owner/direct creator sees everything
    if (item.access === "all") return true;
    if (item.access === "manager") return teamRole === "owner" || teamRole === "manager";
    if (item.access === "owner") return teamRole === "owner";
    return true;
  });

  // Close sidebar on route change
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  // Close sidebar on escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Prevent body scroll when sidebar is open on mobile
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="flex h-16 items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <Image src="/logo.png" alt="FanFlow Logo" width={32} height={32} className="rounded-md" />
          <h1 className="text-xl font-bold text-white">FanFlow</h1>
        </div>
        {/* Close button (mobile only) */}
        <button
          onClick={() => setIsOpen(false)}
          className="rounded-lg p-1 text-gray-400 hover:text-white lg:hidden"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Team Switcher */}
      <TeamSwitcher />

      {/* Global Search */}
      <GlobalSearch />

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {filteredNav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              pathname.startsWith(item.href)
                ? "bg-gray-800 text-white"
                : "text-gray-400 hover:bg-gray-800/50 hover:text-white"
            )}
          >
            <span>{item.icon}</span>
            <span className="flex-1">{item.name}</span>
            <SidebarBadge href={item.href} />
          </Link>
        ))}
        <NotificationBell />
      </nav>

      {/* Admin link */}
      {user.role === "admin" && (
        <div className="px-3 pb-2">
          <Link
            href="/admin"
            className="flex items-center gap-3 rounded-lg bg-red-600/10 px-3 py-2.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-600/20 hover:text-red-300"
          >
            <span>🛡️</span>
            Panel de Admin
          </Link>
        </div>
      )}

      {/* User section */}
      <div className="border-t border-gray-800 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-white">{user.name}</p>
            <p className="text-xs text-gray-400">{user.email}</p>
          </div>
          <button
            onClick={toggleTheme}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-800 hover:text-white"
            title={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
          >
            {theme === "dark" ? (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
          </button>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-400 hover:bg-gray-800 hover:text-white"
        >
          Cerrar sesion
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Hamburger button – mobile only */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed left-4 top-4 z-40 rounded-lg bg-gray-900 p-2 text-gray-400 shadow-lg hover:text-white lg:hidden"
      >
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Desktop sidebar (always visible) */}
      <div className="hidden w-64 flex-col border-r border-gray-800 bg-gray-900 lg:flex">
        {sidebarContent}
      </div>

      {/* Mobile overlay */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 lg:hidden",
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={() => setIsOpen(false)}
      />

      {/* Mobile sidebar (slides in) */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-gray-900 shadow-2xl transition-transform duration-300 ease-in-out lg:hidden",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {sidebarContent}
      </div>
    </>
  );
}

function SidebarBadge({ href }: { href: string }) {
  const realtime = useRealtimeContext();

  // Only enable the comments query for the comments item to avoid global polling
  const isCommentsItem = href === "/comments";
  const commentsOverview = trpc.socialComments.overview.useQuery(undefined, {
    enabled: isCommentsItem,
    staleTime: 30_000,
  });

  if (href === "/conversations") {
    const count = realtime.newMessageConversations.size;
    if (count === 0) return null;
    return <BadgePill value={count} />;
  }

  if (isCommentsItem) {
    const count = commentsOverview.data?.unhandledCount ?? 0;
    if (count === 0) return null;
    return <BadgePill value={count} />;
  }

  return null;
}

function BadgePill({ value }: { value: number }) {
  return (
    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
      {value > 99 ? "99+" : value}
    </span>
  );
}

function NotificationBell() {
  const { data: unreadCount } = trpc.intelligence.getUnreadCount.useQuery();

  return (
    <Link
      href="/dashboard#notifications"
      className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-400 transition-colors hover:bg-gray-800/50 hover:text-white"
    >
      <span className="relative">
        🔔
        {(unreadCount ?? 0) > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount}
          </span>
        )}
      </span>
      Notificaciones
    </Link>
  );
}
