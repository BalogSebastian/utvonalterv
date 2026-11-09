import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kamion útvonaltervező és útdíj-kalkulátor",
  description:
    "Kamionokra optimalizált útvonaltervezés magasság-, súly- és ADR-korlátokkal, útdíj- és fuvarköltség-számítással. OpenStreetMap alapon, ingyenesen.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="hu" className="h-full antialiased">
      <body className="h-full">{children}</body>
    </html>
  );
}
