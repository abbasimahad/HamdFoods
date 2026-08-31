import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { PwaLifecycle } from "@/components/pwa/pwa-lifecycle";

import "./globals.css";

export const metadata: Metadata = {
  applicationName: "Hamd Foods ERP",
  title: { default: "Hamd Foods ERP", template: "%s | Hamd Foods ERP" },
  description: "Secure operations workspace for Hamd Foods manufacturing.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Hamd ERP",
  },
};

export const viewport: Viewport = {
  colorScheme: "light",
  initialScale: 1,
  themeColor: "#176b45",
  viewportFit: "cover",
  width: "device-width",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <PwaLifecycle />
        {children}
      </body>
    </html>
  );
}
