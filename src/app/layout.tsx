import type { Metadata, Viewport } from "next";
import "@fontsource-variable/manrope";
import "@fontsource-variable/dm-sans";
import "./globals.css";
import { AppProviders } from "@/components/providers";
import { Shell } from "@/components/shell";
export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
  ),
  title: {
    default: "SideQuest — Stop scrolling. Go somewhere.",
    template: "%s · SideQuest",
  },
  description:
    "A little context. A few great ideas. Find somewhere actually worth going out for, around Surrey, Berkshire and Hampshire.",
  applicationName: "SideQuest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "SideQuest" },
  icons: { icon: "/icons/icon.svg", apple: "/icons/apple-touch-icon.png" },
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "SideQuest — Stop scrolling. Go somewhere.",
    description: "Your next good idea is closer than you think.",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f6f6ef",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-GB">
      <body>
        <AppProviders>
          <Shell>{children}</Shell>
        </AppProviders>
      </body>
    </html>
  );
}
