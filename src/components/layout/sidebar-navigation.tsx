"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Icon } from "@/components/ui/icon";
import { getActiveNavigationItem, getPermittedNavigation } from "@/config/navigation";
import type { ApplicationPrincipal } from "@/modules/access/domain/principal";

export function SidebarNavigation({
  collapsed = false,
  onNavigate,
  principal,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
  principal: ApplicationPrincipal;
}) {
  const pathname = usePathname();
  const activeItem = getActiveNavigationItem(pathname);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(activeItem?.children ? [activeItem.id] : []),
  );
  const navigation = getPermittedNavigation(principal);

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <nav aria-label="Primary navigation" className="flex-1 overflow-y-auto px-3 pb-5">
      <p
        className={`px-3 pb-2 pt-3 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[var(--sidebar-muted)] ${collapsed ? "sr-only" : ""}`}
      >
        Workspace
      </p>
      <ul className="space-y-1">
        {navigation.map((item) => {
          const active = activeItem?.id === item.id;
          const isExpanded = expanded.has(item.id);
          return (
            <li key={item.id}>
              <div
                className={`group flex items-center rounded-lg ${active ? "bg-[var(--sidebar-active)] text-white" : "text-[var(--sidebar-ink)] hover:bg-[var(--sidebar-hover)]"}`}
              >
                <Link
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sidebar-focus)] ${collapsed ? "justify-center" : ""}`}
                  href={item.href}
                  onClick={() => onNavigate?.()}
                  title={collapsed ? item.label : undefined}
                >
                  <Icon className="size-5 shrink-0" name={item.icon} />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </Link>
                {!collapsed && item.children && (
                  <button
                    aria-controls={`nav-children-${item.id}`}
                    aria-expanded={isExpanded}
                    aria-label={`${isExpanded ? "Collapse" : "Expand"} ${item.label} navigation`}
                    className="mr-1 grid size-10 shrink-0 place-items-center rounded-md text-[var(--sidebar-muted)] outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-[var(--sidebar-focus)]"
                    onClick={() => toggle(item.id)}
                    type="button"
                  >
                    <Icon
                      className={`size-4 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                      name="chevron"
                    />
                  </button>
                )}
              </div>
              {!collapsed && item.children && isExpanded && (
                <ul
                  className="ml-5 border-l border-[var(--sidebar-border)] py-1 pl-3"
                  id={`nav-children-${item.id}`}
                >
                  {item.children.map((child) => {
                    const childActive =
                      pathname === child.href || pathname.startsWith(`${child.href}/`);
                    return child.status === "active" ? (
                      <li key={child.href}>
                        <Link
                          aria-current={childActive ? "page" : undefined}
                          className={`flex min-h-11 items-center rounded-md px-2 text-xs outline-none hover:bg-[var(--sidebar-hover)] focus-visible:ring-2 focus-visible:ring-[var(--sidebar-focus)] ${childActive ? "bg-[var(--sidebar-active)] font-semibold text-white" : "text-[var(--sidebar-ink)]"}`}
                          href={child.href}
                          onClick={() => onNavigate?.()}
                        >
                          {child.label}
                        </Link>
                      </li>
                    ) : (
                      <li
                        className="flex min-h-9 items-center justify-between gap-2 rounded-md px-2 text-xs text-[var(--sidebar-muted)]"
                        key={child.href}
                        title="Available in a future phase"
                      >
                        <span>{child.label}</span>
                        <span className="rounded border border-[var(--sidebar-border)] px-1.5 py-0.5 text-[0.5625rem] font-semibold uppercase tracking-wide">
                          Planned
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
