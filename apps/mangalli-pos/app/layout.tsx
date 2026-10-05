import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

const description = "Mangalli POS: Mulai jualan, tanpa ribet. POS dan menu QR untuk kafe dan restoran dari 1garis Studio.";

export const metadata: Metadata = {
  metadataBase: new URL("https://app.mangalli.web.id"),
  applicationName: "Mangalli POS",
  title: { default: "Dashboard | Mangalli POS", template: "%s | Mangalli POS" },
  description,
  openGraph: {
    description,
    images: [
      {
        alt: "Mangalli POS",
        height: 512,
        url: "/images/brands/mangalli-fnb-logo.png",
        width: 512,
      },
    ],
    siteName: "Mangalli POS",
    title: "Dashboard | Mangalli POS",
    type: "website",
    url: "/",
  },
  twitter: {
    card: "summary",
    description,
    images: ["/images/brands/mangalli-fnb-logo.png"],
    title: "Dashboard | Mangalli POS",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
