"use client";

import dynamic from "next/dynamic";

const Planner = dynamic(() => import("./Planner"), {
  ssr: false,
  loading: () => <div className="flex h-dvh items-center justify-center text-slate-500">Betöltés…</div>,
});

export default function PlannerLoader() {
  return <Planner />;
}
