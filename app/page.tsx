"use client";
import Assistant from "@/components/assistant";
import SessionSidebar from "@/components/session-sidebar";
import { Menu, X } from "lucide-react";
import { useState } from "react";

export default function Main() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen bg-white">
      <div className="hidden md:flex md:w-80 lg:w-[22rem]">
        <SessionSidebar />
      </div>
      <div className="flex-1">
        <Assistant />
      </div>
      <div className="absolute top-4 left-4 md:hidden z-20">
        <button
          onClick={() => setIsSidebarOpen(true)}
          className="rounded-full border border-zinc-200 bg-white p-2 shadow-sm"
          aria-label="Open sessions sidebar"
        >
          <Menu size={24} />
        </button>
      </div>
      {isSidebarOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="w-11/12 max-w-sm">
            <SessionSidebar />
          </div>
          <div className="flex-1 bg-black/40" onClick={() => setIsSidebarOpen(false)} />
          <button
            className="absolute top-4 right-4 text-white"
            onClick={() => setIsSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <X size={24} />
          </button>
        </div>
      )}
    </div>
  );
}
