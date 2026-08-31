import type { ReactNode, SVGProps } from "react";

import type { NavigationIcon } from "@/config/navigation";

export type IconName =
  NavigationIcon | "bell" | "chevron" | "close" | "collapse" | "logout" | "menu" | "user";

type IconProps = SVGProps<SVGSVGElement> & { name: IconName };

const iconPaths: Record<IconName, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  inventory: (
    <>
      <path d="m4 7 8-4 8 4-8 4-8-4Z" />
      <path d="m4 7v10l8 4 8-4V7" />
      <path d="M12 11v10" />
    </>
  ),
  purchasing: (
    <>
      <path d="M3 5h2l2.2 10.5h9.8l2-7.5H6" />
      <circle cx="9" cy="20" r="1" />
      <circle cx="17" cy="20" r="1" />
    </>
  ),
  production: (
    <>
      <path d="M4 21V9l5 3V9l5 3V5h6v16H4Z" />
      <path d="M8 17h2M14 17h2" />
    </>
  ),
  sales: (
    <>
      <path d="M4 19V9l8-5 8 5v10" />
      <path d="M2 20h20M8 20v-6h8v6" />
    </>
  ),
  accounting: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 7h8M8 11h2M14 11h2M8 15h2M14 15h2" />
    </>
  ),
  reports: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </>
  ),
  administration: (
    <>
      <circle cx="12" cy="8" r="3" />
      <path d="M5 21v-2a7 7 0 0 1 14 0v2" />
      <path d="M19 4v4M17 6h4" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </>
  ),
  chevron: <path d="m9 18 6-6-6-6" />,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  collapse: (
    <>
      <path d="m14 18-6-6 6-6" />
      <path d="M20 4v16" />
    </>
  ),
  logout: (
    <>
      <path d="M10 5H5v14h5" />
      <path d="m14 8 4 4-4 4M18 12H9" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
};

export function Icon({ name, className, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      viewBox="0 0 24 24"
      {...props}
    >
      {iconPaths[name]}
    </svg>
  );
}
