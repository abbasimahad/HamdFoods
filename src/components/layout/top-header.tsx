"use client";

import type { RefObject } from "react";

import { Icon } from "@/components/ui/icon";
import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import { LogoutButton } from "@/components/auth/logout-button";

export function TopHeader({
  menuButtonRef,
  onOpenMenu,
  principal,
}: {
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  onOpenMenu: () => void;
  principal: ApplicationPrincipal;
}) {
  return (
    <header className="pwa-safe-header sticky top-0 z-20 flex min-h-16 items-center justify-between gap-2 border-b border-[var(--border)] bg-[color:var(--raised-translucent)] px-3 py-2 backdrop-blur-sm sm:px-6 xl:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <button
          aria-label="Open navigation menu"
          className="grid size-11 shrink-0 place-items-center rounded-lg border border-[var(--border)] bg-white text-[var(--ink)] outline-none hover:bg-[var(--surface)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] lg:hidden"
          onClick={onOpenMenu}
          ref={menuButtonRef}
          type="button"
        >
          <Icon className="size-5" name="menu" />
        </button>
        <div className="hidden min-w-0 min-[430px]:block">
          <p className="truncate text-sm font-semibold text-[var(--ink)]">Hamd ERP</p>
          <p className="hidden truncate text-xs text-[var(--muted)] sm:block">
            Food manufacturing ERP
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          aria-label="Notifications placeholder; notifications are not available yet"
          className="hidden size-11 place-items-center rounded-lg text-[var(--muted)] outline-none hover:bg-[var(--surface)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] sm:grid"
          title="Notifications are coming in a later phase"
          type="button"
        >
          <Icon className="size-5" name="bell" />
        </button>
        <div
          className="flex min-h-11 items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-2.5"
          title={principal.email}
        >
          <span className="grid size-7 place-items-center rounded-md bg-[var(--accent-soft)] text-[var(--accent)]">
            <Icon className="size-4" name="user" />
          </span>
          <span className="hidden text-left sm:block">
            <span className="block max-w-36 truncate text-xs font-semibold text-[var(--ink)]">
              {principal.name}
            </span>
            <span className="block max-w-36 truncate text-[0.6875rem] text-[var(--muted)]">
              {principal.email}
            </span>
          </span>
        </div>
        <LogoutButton />
      </div>
    </header>
  );
}
