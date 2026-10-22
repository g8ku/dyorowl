import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://dyorowl.com"),
  title: "DYOR Owl",
  description: "An AI detective owl that investigates memecoins, and comics that teach you to do it yourself. Coming soon.",
  openGraph: {
    title: "DYOR Owl",
    description: "Every coin is a case. Coming soon.",
    url: "https://dyorowl.com",
    siteName: "DYOR Owl",
    type: "website",
  },
  twitter: {
    card: "summary",
    site: "@dyorowl",
    title: "DYOR Owl",
    description: "Every coin is a case. Coming soon.",
  },
};

export const viewport: Viewport = {
  themeColor: "#0c0f2e",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Dela+Gothic+One&family=Figtree:wght@400;600;800&family=IBM+Plex+Mono:wght@500;600&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
