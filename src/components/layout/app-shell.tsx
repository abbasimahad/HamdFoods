"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/ui/icon";
import type { ApplicationPrincipal } from "@/modules/access/domain/principal";

import { SidebarNavigation } from "./sidebar-navigation";
import { TopHeader } from "./top-header";

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`flex h-16 items-center gap-3 border-b border-[var(--sidebar-border)] px-4 ${compact ? "justify-center" : ""}`}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--accent-bright)] text-sm font-black text-white">
        FE
      </span>
      {!compact && (
        <span>
          <span className="block text-sm font-bold text-white">Factory ERP</span>
          <span className="block text-[0.6875rem] text-[var(--sidebar-muted)]">
            Operations control
          </span>
        </span>
      )}
    </div>
  );
}

export function AppShell({
  children,
  principal,
}: {
  children: ReactNode;
  principal: ApplicationPrincipal;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const restoreMenuFocusRef = useRef(false);

  function closeMobileMenu(restoreFocus = true) {
    restoreMenuFocusRef.current = restoreFocus;
    setMobileOpen(false);
  }

  useEffect(() => {
    if (!mobileOpen && restoreMenuFocusRef.current) {
      restoreMenuFocusRef.current = false;
      menuButtonRef.current?.focus();
    }
  }, [mobileOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMobileMenu();
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;

      const focusable = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileOpen]);

  return (
    <div className="min-h-dvh bg-[var(--surface)]">
      <aside
        className={`erp-chrome fixed inset-y-0 left-0 z-30 hidden flex-col bg-[var(--sidebar)] transition-[width] duration-200 lg:flex ${collapsed ? "w-20" : "w-72"}`}
      >
        <Brand compact={collapsed} />
        <SidebarNavigation collapsed={collapsed} principal={principal} />
        <div className="border-t border-[var(--sidebar-border)] p-3">
          <button
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-[var(--sidebar-muted)] outline-none hover:bg-[var(--sidebar-hover)] hover:text-white focus-visible:ring-2 focus-visible:ring-[var(--sidebar-focus)] ${collapsed ? "justify-center" : ""}`}
            onClick={() => setCollapsed((value) => !value)}
            type="button"
          >
            <Icon className={`size-5 shrink-0 ${collapsed ? "rotate-180" : ""}`} name="collapse" />
            {!collapsed && <span>Collapse sidebar</span>}
          </button>
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Close navigation menu"
            className="absolute inset-0 bg-black/45"
            onClick={() => closeMobileMenu()}
            type="button"
          />
          <aside
            aria-label="Mobile navigation"
            aria-modal="true"
            className="relative flex h-full w-[min(88vw,22rem)] flex-col bg-[var(--sidebar)] shadow-2xl"
            ref={drawerRef}
            role="dialog"
          >
            <div className="flex items-center justify-between border-b border-[var(--sidebar-border)] pr-3">
              <Brand />
              <button
                aria-label="Close navigation menu"
                className="grid size-11 place-items-center rounded-lg text-[var(--sidebar-muted)] outline-none hover:bg-[var(--sidebar-hover)] hover:text-white focus-visible:ring-2 focus-visible:ring-[var(--sidebar-focus)]"
                onClick={() => closeMobileMenu()}
                ref={closeButtonRef}
                type="button"
              >
                <Icon className="size-5" name="close" />
              </button>
            </div>
            <SidebarNavigation principal={principal} onNavigate={() => closeMobileMenu(false)} />
          </aside>
        </div>
      )}

      <div
        aria-hidden={mobileOpen}
        className={`erp-content min-w-0 transition-[padding] duration-200 ${collapsed ? "lg:pl-20" : "lg:pl-72"}`}
        inert={mobileOpen}
      >
        <div className="erp-chrome">
          <TopHeader
            menuButtonRef={menuButtonRef}
            onOpenMenu={() => setMobileOpen(true)}
            principal={principal}
          />
        </div>
        <main>{children}</main>
      </div>
    </div>
  );
}
