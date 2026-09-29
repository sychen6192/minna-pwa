"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  Home,
  PencilLine,
  RotateCcw,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "首頁", icon: Home },
  { href: "/lessons", label: "課程", icon: BookOpen },
  { href: "/review", label: "複習", icon: RotateCcw },
  { href: "/quiz", label: "測驗", icon: PencilLine },
  { href: "/stats", label: "統計", icon: BarChart3 },
  { href: "/settings", label: "設定", icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="主導覽"
      className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-screen-sm border-t border-border bg-background pb-[env(safe-area-inset-bottom)]"
    >
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex flex-1 flex-col items-center gap-1 py-2 text-xs transition-colors",
              // 目前分頁:連結色 + 加粗 + 頂部指示條(不只靠明暗區分;深色下 link 為 sky-400)
              active
                ? "font-medium text-link before:absolute before:inset-x-4 before:top-0 before:h-0.5 before:rounded-full before:bg-current"
                : "text-muted-foreground",
            )}
          >
            <Icon className="size-5" strokeWidth={active ? 2.5 : 2} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
