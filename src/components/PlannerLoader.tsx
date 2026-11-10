"use client";

import dynamic from "next/dynamic";

const Planner = dynamic(() => import("./Planner"), { ssr: false, loading: () => null });

export default function PlannerLoader() {
  return <Planner />;
}
