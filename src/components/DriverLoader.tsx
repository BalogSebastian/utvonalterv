"use client";

import dynamic from "next/dynamic";

const DriverView = dynamic(() => import("./DriverView"), { ssr: false, loading: () => null });

export default function DriverLoader() {
  return <DriverView />;
}
