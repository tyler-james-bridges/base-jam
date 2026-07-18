import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Space_Grotesk, Space_Mono } from "next/font/google";
import { Providers } from "@/components/Providers";
import "./globals.css";

const display = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
});

const mono = Space_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const appUrl =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
  "https://basejam.0x402.sh";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: "BASE JAM — Pack a real Base block",
    template: "%s · BASE JAM",
  },
  description:
    "A one-thumb packing game generated from real Base transactions. Same block. Same pieces. Your best jam.",
  applicationName: "BASE JAM",
  category: "game",
  keywords: ["Base", "onchain", "game", "blockchain", "daily challenge"],
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/mark.svg",
    apple: "/icon-grid.svg",
  },
  openGraph: {
    type: "website",
    title: "BASE JAM — Pack a real Base block",
    description:
      "Real Base transactions become one shared 10×10 packing challenge.",
    siteName: "BASE JAM",
    images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "BASE JAM — Pack a real Base block",
    description:
      "Real Base transactions become one shared 10×10 packing challenge.",
    images: ["/opengraph-image"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f4eedb",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${mono.variable}`}>
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
