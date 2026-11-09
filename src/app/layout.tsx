import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin", "latin-ext"] });
const brand = Space_Grotesk({ variable: "--font-brand", subsets: ["latin", "latin-ext"] });

export const metadata: Metadata = {
  title: "tesotter routeR – kamion útvonaltervező és útdíj-kalkulátor",
  description:
    "Kamionokra optimalizált útvonaltervezés magasság-, súly- és ADR-korlátokkal, útdíj- és fuvarköltség-számítással. OpenStreetMap alapon, ingyenesen.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="hu" className={`${inter.variable} ${brand.variable} h-full antialiased`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
