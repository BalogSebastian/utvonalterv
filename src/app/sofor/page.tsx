import type { Metadata } from "next";
import DriverLoader from "@/components/DriverLoader";

export const metadata: Metadata = {
  title: "Útvonal a sofőrnek – tesotter routeR",
  description: "Kamionos útvonal: navigáció indítása Google Maps / Waze / OsmAnd appban, megállók és pihenők.",
  robots: { index: false, follow: false },
};

export default function DriverPage() {
  return <DriverLoader />;
}
