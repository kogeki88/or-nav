"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ProfileRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem("ornav_open_profile_on_mount", "true");
      router.replace("/");
    }
  }, [router]);

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[#09090b] text-zinc-300 font-mono text-sm">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
        <span>Loading Clinician Profile &amp; Assignment...</span>
      </div>
    </div>
  );
}
